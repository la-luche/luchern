import AVFoundation
import CoreImage
import CoreVideo
import ExpoModulesCore
import QuickPoseCore

private let progressEvent = "onFaceBlurProgress"
private let scanProgressShare = 0.45
private let maximumPoseDimension: CGFloat = 512
private let additionalFacePaddingPerEdge: CGFloat = 0.20

private struct PrivacyBlurStats {
  var framesProcessed = 0
  var framesWithFaces = 0
  var framesWithBackgroundBlur = 0
}

/** Normalized top-left coordinates, matching QuickPose/MediaPipe landmarks. */
private struct NormalizedRect {
  let left: CGFloat
  let top: CGFloat
  let right: CGFloat
  let bottom: CGFloat

  var isEmpty: Bool { right <= left || bottom <= top }
  var width: CGFloat { max(0, right - left) }
  var height: CGFloat { max(0, bottom - top) }

  func interpolated(to other: NormalizedRect, fraction: CGFloat) -> NormalizedRect {
    let t = min(1, max(0, fraction))
    return NormalizedRect(
      left: left + (other.left - left) * t,
      top: top + (other.top - top) * t,
      right: right + (other.right - right) * t,
      bottom: bottom + (other.bottom - bottom) * t
    )
  }

  func coreImageRect(in extent: CGRect) -> CGRect {
    CGRect(
      x: extent.minX + left * extent.width,
      y: extent.minY + (1 - bottom) * extent.height,
      width: (right - left) * extent.width,
      height: (bottom - top) * extent.height
    ).intersection(extent)
  }
}

private struct PoseKeyframe {
  let seconds: Double
  let person: NormalizedRect?
  let face: NormalizedRect?
}

private struct PrivacyRects {
  let person: NormalizedRect?
  let face: NormalizedRect?
}

private struct PoseTimeline {
  let keyframes: [PoseKeyframe]

  var poseSamples: Int { keyframes.filter { $0.person != nil }.count }
  var faceSamples: Int { keyframes.filter { $0.face != nil }.count }

  var isReliableForFace: Bool {
    guard !keyframes.isEmpty else { return false }
    return faceSamples >= Int(ceil(Double(keyframes.count) * 0.4))
  }

  var isReliableForBackground: Bool {
    guard !keyframes.isEmpty else { return false }
    let minimumReliableSamples = Int(ceil(Double(keyframes.count) * 0.6))
    guard poseSamples >= minimumReliableSamples else { return false }
    let reliableSamples = keyframes.filter { keyframe in
      guard let person = keyframe.person, let face = keyframe.face,
            person.width > 0, person.height > 0 else {
        return false
      }
      // Reject the characteristic failure where BlazePose merges a nearby
      // hand with a different, smaller person elsewhere in the frame.
      let bodyAspect = person.height / person.width
      let relativeFaceWidth = face.width / person.width
      return bodyAspect >= 1.05 && relativeFaceWidth >= 0.10
    }.count
    return reliableSamples >= minimumReliableSamples
  }

  func rects(at seconds: Double) -> PrivacyRects? {
    guard let first = keyframes.first else { return nil }
    if seconds <= first.seconds {
      return PrivacyRects(person: first.person, face: first.face)
    }
    guard let last = keyframes.last else { return nil }
    if seconds >= last.seconds {
      return PrivacyRects(person: last.person, face: last.face)
    }

    var low = 0
    var high = keyframes.count - 1
    while low + 1 < high {
      let middle = (low + high) / 2
      if keyframes[middle].seconds <= seconds {
        low = middle
      } else {
        high = middle
      }
    }

    let before = keyframes[low]
    let after = keyframes[high]
    let span = max(0.000_001, after.seconds - before.seconds)
    let fraction = CGFloat((seconds - before.seconds) / span)
    let person: NormalizedRect?
    switch (before.person, after.person) {
    case let (.some(a), .some(b)):
      person = a.interpolated(to: b, fraction: fraction)
    default:
      person = fraction < 0.5 ? before.person : after.person
    }
    let face: NormalizedRect?
    switch (before.face, after.face) {
    case let (.some(a), .some(b)):
      face = a.interpolated(to: b, fraction: fraction)
    default:
      face = fraction < 0.5 ? before.face : after.face
    }
    return PrivacyRects(person: person, face: face)
  }
}

private enum CapturedPose {
  case landmarks(QuickPose.Landmarks)
  case noPerson
  case invalidSDKKey
}

private final class PoseCaptureWaiter {
  private let lock = NSLock()
  private var semaphore: DispatchSemaphore?
  private var result: CapturedPose?

  func begin() -> DispatchSemaphore {
    lock.lock()
    defer { lock.unlock() }
    let next = DispatchSemaphore(value: 0)
    semaphore = next
    result = nil
    return next
  }

  func finish(status: QuickPose.Status, landmarks: QuickPose.Landmarks?) {
    lock.lock()
    guard let semaphore else {
      lock.unlock()
      return
    }
    switch status {
    case .success:
      result = landmarks.map(CapturedPose.landmarks) ?? .noPerson
    case .noPersonFound:
      result = .noPerson
    case .sdkValidationError:
      result = .invalidSDKKey
    }
    self.semaphore = nil
    lock.unlock()
    semaphore.signal()
  }

  func take() -> CapturedPose? {
    lock.lock()
    defer { lock.unlock() }
    let captured = result
    result = nil
    return captured
  }
}

private final class QuickPoseVideoScanner {
  private let asset: AVURLAsset
  private let sdkKey: String
  private let sampleInterval: Double
  private let progress: (Double) -> Void
  private let isCancelled: () -> Bool
  private let ciContext = CIContext(options: [.cacheIntermediates: false])

  init(
    asset: AVURLAsset,
    sdkKey: String,
    sampleIntervalMilliseconds: Int,
    progress: @escaping (Double) -> Void,
    isCancelled: @escaping () -> Bool
  ) {
    self.asset = asset
    self.sdkKey = sdkKey
    self.sampleInterval = Double(min(1_000, max(100, sampleIntervalMilliseconds))) / 1_000
    self.progress = progress
    self.isCancelled = isCancelled
  }

  func scan() throws -> PoseTimeline {
    guard !sdkKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw Self.error(20, "QuickPose SDK key is not configured for this build.")
    }
    let duration = CMTimeGetSeconds(asset.duration)
    guard duration.isFinite, duration > 0 else {
      throw Self.error(21, "The recording duration could not be read.")
    }

    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: maximumPoseDimension, height: maximumPoseDimension)
    generator.requestedTimeToleranceBefore = CMTime(seconds: sampleInterval / 2, preferredTimescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(seconds: sampleInterval / 2, preferredTimescale: 600)

    var sampleSeconds = stride(from: 0.0, to: duration, by: sampleInterval).map { $0 }
    let finalSample = max(0, duration - 1.0 / 600.0)
    if sampleSeconds.isEmpty || finalSample - (sampleSeconds.last ?? 0) > sampleInterval / 3 {
      sampleSeconds.append(finalSample)
    }

    let waiter = PoseCaptureWaiter()
    let started = DispatchSemaphore(value: 0)
    let quickPose = QuickPose(sdkKey: sdkKey)
    quickPose.disableLogging()
    quickPose.start(
      features: [.showPoints(style: QuickPose.Style(hidden: true))],
      modelConfig: QuickPose.ModelConfig(
        detailedFaceTracking: false,
        detailedHandTracking: false,
        modelComplexity: .light,
        rotationDegrees: 0
      ),
      onStart: { started.signal() },
      onFrame: { status, _, _, _, landmarks in
        waiter.finish(status: status, landmarks: landmarks)
      }
    )
    defer { quickPose.stop() }
    guard started.wait(timeout: .now() + 8) == .success else {
      throw Self.error(22, "QuickPose did not become ready.")
    }

    var keyframes: [PoseKeyframe] = []
    for (index, requestedSeconds) in sampleSeconds.enumerated() {
      if isCancelled() { throw Self.cancelledError() }
      var actualTime = CMTime.zero
      let image = try generator.copyCGImage(
        at: CMTime(seconds: requestedSeconds, preferredTimescale: 600),
        actualTime: &actualTime
      )
      let pixelBuffer = try makePixelBuffer(from: image)
      let semaphore = waiter.begin()
      quickPose.captureAVOutput(
        didOutput: pixelBuffer,
        timestamp: actualTime,
        isFrontCamera: false
      )
      guard semaphore.wait(timeout: .now() + 8) == .success else {
        throw Self.error(23, "QuickPose timed out while reading the recording.")
      }
      if isCancelled() { throw Self.cancelledError() }
      switch waiter.take() {
      case .landmarks(let landmarks):
        let person = personRect(from: landmarks)
        keyframes.append(PoseKeyframe(
          seconds: max(0, CMTimeGetSeconds(actualTime)),
          person: person,
          face: person == nil ? nil : faceRect(from: landmarks)
        ))
      case .invalidSDKKey:
        throw Self.error(24, "The QuickPose SDK key is not valid for this app.")
      case .noPerson, .none:
        keyframes.append(PoseKeyframe(
          seconds: max(0, CMTimeGetSeconds(actualTime)),
          person: nil,
          face: nil
        ))
      }
      progress(scanProgressShare * Double(index + 1) / Double(sampleSeconds.count))
    }

    guard keyframes.contains(where: { $0.person != nil }) else {
      throw Self.error(25, "QuickPose could not detect a person in this recording.")
    }
    return PoseTimeline(keyframes: keyframes.sorted { $0.seconds < $1.seconds })
  }

  private func makePixelBuffer(from image: CGImage) throws -> CVPixelBuffer {
    var buffer: CVPixelBuffer?
    let attributes: [CFString: Any] = [
      kCVPixelBufferCGImageCompatibilityKey: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey: true,
      kCVPixelBufferIOSurfacePropertiesKey: [:]
    ]
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault,
      image.width,
      image.height,
      kCVPixelFormatType_32BGRA,
      attributes as CFDictionary,
      &buffer
    )
    guard status == kCVReturnSuccess, let buffer else {
      throw Self.error(26, "A pose-estimation image buffer could not be created.")
    }
    ciContext.render(
      CIImage(cgImage: image),
      to: buffer,
      bounds: CGRect(x: 0, y: 0, width: image.width, height: image.height),
      colorSpace: CGColorSpaceCreateDeviceRGB()
    )
    return buffer
  }

  private func personRect(from landmarks: QuickPose.Landmarks) -> NormalizedRect? {
    let points = landmarks.allLandmarksForBody().compactMap(normalizedPoint)
    guard points.count >= 6 else { return nil }
    let bounds = bounds(of: points)
    let width = max(0.05, bounds.right - bounds.left)
    let height = max(0.1, bounds.bottom - bounds.top)
    return NormalizedRect(
      left: max(0, bounds.left - max(0.10, width * 0.32)),
      top: max(0, bounds.top - max(0.08, height * 0.22)),
      right: min(1, bounds.right + max(0.10, width * 0.32)),
      bottom: min(1, bounds.bottom + max(0.10, height * 0.18))
    )
  }

  private func faceRect(from landmarks: QuickPose.Landmarks) -> NormalizedRect? {
    let joints: [QuickPose.Landmarks.Body] = [
      .nose,
      .eyeInner(side: .left), .eye(side: .left), .eyeOuter(side: .left),
      .eyeInner(side: .right), .eye(side: .right), .eyeOuter(side: .right),
      .ear(side: .left), .ear(side: .right),
      .mouth(side: .left), .mouth(side: .right)
    ]
    let points = joints.compactMap { normalizedPoint(landmarks.landmark(forBody: $0)) }
    guard points.count >= 3 else { return nil }
    let bounds = bounds(of: points)
    let width = max(0.025, bounds.right - bounds.left)
    let height = max(0.035, bounds.bottom - bounds.top)
    // Production-video review found the prior face mask too tight. Expand
    // every edge by another 20% of the measured head width/height while
    // preserving the existing asymmetric forehead/chin padding.
    return NormalizedRect(
      left: max(0, bounds.left - width * (0.20 + additionalFacePaddingPerEdge)),
      top: max(0, bounds.top - height * (0.50 + additionalFacePaddingPerEdge)),
      right: min(1, bounds.right + width * (0.20 + additionalFacePaddingPerEdge)),
      bottom: min(1, bounds.bottom + height * (0.25 + additionalFacePaddingPerEdge))
    )
  }

  private func normalizedPoint(_ point: QuickPose.Point3d) -> CGPoint? {
    guard point.visibility >= 0.25, point.presence >= 0.25 else { return nil }
    let projected = point.cgPoint(scaledTo: CGSize(width: 1, height: 1))
    guard projected.x.isFinite, projected.y.isFinite,
          projected.x >= -0.1, projected.x <= 1.1,
          projected.y >= -0.1, projected.y <= 1.1 else {
      return nil
    }
    return CGPoint(x: min(1, max(0, projected.x)), y: min(1, max(0, projected.y)))
  }

  private func bounds(of points: [CGPoint]) -> NormalizedRect {
    NormalizedRect(
      left: points.map(\.x).min() ?? 0,
      top: points.map(\.y).min() ?? 0,
      right: points.map(\.x).max() ?? 0,
      bottom: points.map(\.y).max() ?? 0
    )
  }

  private static func error(_ code: Int, _ message: String) -> NSError {
    NSError(domain: "FaceBlur", code: code, userInfo: [NSLocalizedDescriptionKey: message])
  }

  private static func cancelledError() -> NSError {
    NSError(
      domain: NSCocoaErrorDomain,
      code: NSUserCancelledError,
      userInfo: [NSLocalizedDescriptionKey: "Video privacy processing was cancelled."]
    )
  }
}

private final class FaceBlurProcessor {
  private let inputURL: URL
  private let outputURL: URL
  private let sdkKey: String
  private let blurFaces: Bool
  private let blurBackground: Bool
  private let sampleIntervalMilliseconds: Int
  private let progress: (Double) -> Void
  private let completion: (Result<[String: Any], Error>) -> Void
  private let stateLock = NSLock()
  private let ciContext = CIContext(options: [.cacheIntermediates: false])

  private var exportSession: AVAssetExportSession?
  private var progressTimer: DispatchSourceTimer?
  private var timeline: PoseTimeline?
  private var stats = PrivacyBlurStats()
  private var cancelled = false
  private var firstFrameError: Error?

  init(
    inputURL: URL,
    outputURL: URL,
    sdkKey: String,
    blurFaces: Bool,
    blurBackground: Bool,
    sampleIntervalMilliseconds: Int,
    progress: @escaping (Double) -> Void,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) throws {
    guard inputURL.isFileURL, outputURL.isFileURL else {
      throw Self.error(1, "Video privacy processing requires local file URLs.")
    }
    guard blurFaces || blurBackground else {
      throw Self.error(2, "At least one video privacy option must be enabled.")
    }
    self.inputURL = inputURL
    self.outputURL = outputURL
    self.sdkKey = sdkKey
    self.blurFaces = blurFaces
    self.blurBackground = blurBackground
    self.sampleIntervalMilliseconds = sampleIntervalMilliseconds
    self.progress = progress
    self.completion = completion
  }

  func start() {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self else { return }
      do {
        try FileManager.default.createDirectory(
          at: self.outputURL.deletingLastPathComponent(),
          withIntermediateDirectories: true
        )
        try? FileManager.default.removeItem(at: self.outputURL)
        let asset = AVURLAsset(url: self.inputURL)
        let scanner = QuickPoseVideoScanner(
          asset: asset,
          sdkKey: self.sdkKey,
          sampleIntervalMilliseconds: self.sampleIntervalMilliseconds,
          progress: self.progress,
          isCancelled: { [weak self] in self?.isCancelled ?? true }
        )
        let timeline = try scanner.scan()
        if self.blurFaces && !timeline.isReliableForFace {
          throw Self.error(28, "QuickPose could not reliably locate a face in this recording.")
        }
        if self.blurBackground && !timeline.isReliableForBackground {
          throw Self.error(
            27,
            "QuickPose could not reliably isolate one prominent full-body person for background blur."
          )
        }
        if self.isCancelled { throw Self.cancelledError() }
        self.stateLock.lock()
        self.timeline = timeline
        self.stateLock.unlock()
        try self.startExport(asset: asset, timeline: timeline)
      } catch {
        try? FileManager.default.removeItem(at: self.outputURL)
        self.completion(.failure(error))
      }
    }
  }

  func cancel() {
    stateLock.lock()
    cancelled = true
    let exporter = exportSession
    stateLock.unlock()
    exporter?.cancelExport()
  }

  private var isCancelled: Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return cancelled
  }

  private func startExport(asset: AVURLAsset, timeline: PoseTimeline) throws {
    guard let exporter = AVAssetExportSession(
      asset: asset,
      presetName: AVAssetExportPresetHighestQuality
    ) else {
      throw Self.error(3, "This video cannot be prepared for privacy blurring.")
    }

    let composition = AVVideoComposition(asset: asset) { [weak self] request in
      self?.process(request: request, timeline: timeline)
    }
    exporter.videoComposition = composition
    exporter.outputURL = outputURL
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = true
    stateLock.lock()
    exportSession = exporter
    stateLock.unlock()

    startProgressTimer(exporter)
    exporter.exportAsynchronously { [weak self] in
      self?.finishExport()
    }
  }

  private func process(request: AVAsynchronousCIImageFilteringRequest, timeline: PoseTimeline) {
    stateLock.lock()
    let shouldCancel = cancelled
    let existingError = firstFrameError
    stateLock.unlock()
    if let existingError {
      request.finish(with: existingError)
      return
    }
    if shouldCancel {
      request.finish(with: Self.cancelledError())
      return
    }

    do {
      let source = request.sourceImage
      let extent = source.extent.integral
      guard extent.width > 0, extent.height > 0 else {
        throw Self.error(4, "A video frame could not be decoded.")
      }
      guard let rects = timeline.rects(at: CMTimeGetSeconds(request.compositionTime)) else {
        throw Self.error(5, "No interpolated pose was available for a video frame.")
      }

      var output = source
      if blurBackground {
        let blurred = source
          .clampedToExtent()
          .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 24])
          .cropped(to: extent)
        if let normalizedPerson = rects.person {
          let person = normalizedPerson.coreImageRect(in: extent)
          guard !person.isEmpty else {
            throw Self.error(6, "The person region was empty while blurring the background.")
          }
          let black = CIImage(color: .black).cropped(to: extent)
          let whitePerson = CIImage(color: .white).cropped(to: person)
          let feather = max(8, min(extent.width, extent.height) * 0.015)
          let mask = whitePerson
            .composited(over: black)
            .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: feather])
            .cropped(to: extent)
          output = source.applyingFilter(
            "CIBlendWithMask",
            parameters: [
              kCIInputBackgroundImageKey: blurred,
              kCIInputMaskImageKey: mask
            ]
          )
        } else {
          // If a sparse sample genuinely has no person, the entire frame is
          // background. Do not preserve a stale person box from another time.
          output = blurred
        }
      }

      var faceWasBlurred = false
      if blurFaces, let normalizedFace = rects.face {
        let face = normalizedFace.coreImageRect(in: extent)
        if !face.isEmpty {
          let mosaicScale = max(10, min(face.width, face.height) / 7)
          let redacted = source
            .clampedToExtent()
            .applyingFilter(
              "CIPixellate",
              parameters: [
                kCIInputScaleKey: mosaicScale,
                kCIInputCenterKey: CIVector(x: face.midX, y: face.midY)
              ]
            )
            .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 10])
            .cropped(to: face)
          output = redacted.composited(over: output)
          faceWasBlurred = true
        }
      }

      stateLock.lock()
      stats.framesProcessed += 1
      if faceWasBlurred { stats.framesWithFaces += 1 }
      if blurBackground { stats.framesWithBackgroundBlur += 1 }
      stateLock.unlock()
      request.finish(with: output.cropped(to: extent), context: ciContext)
    } catch {
      stateLock.lock()
      if firstFrameError == nil { firstFrameError = error }
      stateLock.unlock()
      request.finish(with: error)
    }
  }

  private func startProgressTimer(_ exporter: AVAssetExportSession) {
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now(), repeating: .milliseconds(250))
    timer.setEventHandler { [weak self, weak exporter] in
      guard let self, let exporter else { return }
      let exportProgress = min(0.99, max(0, Double(exporter.progress)))
      self.progress(scanProgressShare + exportProgress * (0.99 - scanProgressShare))
    }
    progressTimer = timer
    timer.resume()
  }

  private func finishExport() {
    progressTimer?.cancel()
    progressTimer = nil

    stateLock.lock()
    let wasCancelled = cancelled
    let frameError = firstFrameError
    let finalStats = stats
    let finalTimeline = timeline
    let exporter = exportSession
    exportSession = nil
    stateLock.unlock()

    guard let exporter else { return }
    if wasCancelled || exporter.status == .cancelled {
      try? FileManager.default.removeItem(at: outputURL)
      completion(.failure(Self.cancelledError()))
      return
    }
    if let error = frameError ?? exporter.error {
      try? FileManager.default.removeItem(at: outputURL)
      completion(.failure(error))
      return
    }
    guard exporter.status == .completed else {
      try? FileManager.default.removeItem(at: outputURL)
      completion(.failure(Self.error(7, "Video privacy processing did not finish.")))
      return
    }

    progress(1)
    completion(.success([
      "outputUri": outputURL.absoluteString,
      "framesProcessed": finalStats.framesProcessed,
      "framesWithFaces": finalStats.framesWithFaces,
      "framesWithBackgroundBlur": finalStats.framesWithBackgroundBlur,
      "poseSamples": finalTimeline?.poseSamples ?? 0
    ]))
  }

  private static func error(_ code: Int, _ message: String) -> NSError {
    NSError(domain: "FaceBlur", code: code, userInfo: [NSLocalizedDescriptionKey: message])
  }

  private static func cancelledError() -> NSError {
    NSError(
      domain: NSCocoaErrorDomain,
      code: NSUserCancelledError,
      userInfo: [NSLocalizedDescriptionKey: "Video privacy processing was cancelled."]
    )
  }
}

public final class FaceBlurModule: Module {
  private let operationsLock = NSLock()
  private var operations: [String: FaceBlurProcessor] = [:]

  public func definition() -> ModuleDefinition {
    Name("FaceBlur")
    Events(progressEvent)

    AsyncFunction("blurVideoAsync") {
      (
        inputURL: URL,
        outputURL: URL,
        operationId: String,
        sdkKey: String,
        blurFaces: Bool,
        blurBackground: Bool,
        poseSampleIntervalMilliseconds: Int,
        promise: Promise
      ) in
      self.operationsLock.lock()
      let alreadyRunning = self.operations[operationId] != nil
      self.operationsLock.unlock()
      if alreadyRunning {
        promise.reject("ERR_FACE_BLUR_BUSY", "This recording is already being processed.")
        return
      }

      do {
        let processor = try FaceBlurProcessor(
          inputURL: inputURL,
          outputURL: outputURL,
          sdkKey: sdkKey,
          blurFaces: blurFaces,
          blurBackground: blurBackground,
          sampleIntervalMilliseconds: poseSampleIntervalMilliseconds,
          progress: { [weak self] value in
            DispatchQueue.main.async {
              self?.sendEvent(progressEvent, [
                "operationId": operationId,
                "progress": value
              ])
            }
          },
          completion: { [weak self] result in
            self?.operationsLock.lock()
            self?.operations.removeValue(forKey: operationId)
            self?.operationsLock.unlock()
            switch result {
            case .success(let response): promise.resolve(response)
            case .failure(let error): promise.reject("ERR_FACE_BLUR", error.localizedDescription)
            }
          }
        )
        self.operationsLock.lock()
        self.operations[operationId] = processor
        self.operationsLock.unlock()
        processor.start()
      } catch {
        promise.reject("ERR_FACE_BLUR", error.localizedDescription)
      }
    }

    AsyncFunction("cancelAsync") { (operationId: String) in
      self.operationsLock.lock()
      let processor = self.operations[operationId]
      self.operationsLock.unlock()
      processor?.cancel()
    }
  }
}
