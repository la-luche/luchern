import AVFoundation
import CoreImage
import ExpoModulesCore

private let progressEvent = "onFaceBlurProgress"
private let scanProgressShare = 0.45

private struct PrivacyBlurStats {
  var framesProcessed = 0
  var framesWithFaces = 0
  var framesWithBackgroundBlur = 0
}

/** Normalized top-left coordinates. */
private struct NormalizedRect {
  let left: CGFloat
  let top: CGFloat
  let right: CGFloat
  let bottom: CGFloat

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

  func scaledHeight(_ scale: CGFloat) -> NormalizedRect {
    let padding = height * max(0, scale - 1) / 2
    return NormalizedRect(
      left: left,
      top: max(0, top - padding),
      right: right,
      bottom: min(1, bottom + padding)
    )
  }

  func coreImageRect(in extent: CGRect) -> CGRect {
    CGRect(
      x: extent.minX + left * extent.width,
      y: extent.minY + (1 - bottom) * extent.height,
      width: width * extent.width,
      height: height * extent.height
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

  /** Match exp-0012's 0.25 x median-area body outlier rejection. */
  func filteredForBodyOutliers() -> PoseTimeline {
    let areas = keyframes.compactMap { keyframe -> CGFloat? in
      guard let person = keyframe.person else { return nil }
      return person.width * person.height
    }.sorted()
    guard !areas.isEmpty else { return self }
    let medianArea = areas[areas.count / 2]
    return PoseTimeline(keyframes: keyframes.map { keyframe in
      guard let person = keyframe.person,
            person.width * person.height >= medianArea * 0.25 else {
        return PoseKeyframe(seconds: keyframe.seconds, person: nil, face: nil)
      }
      return keyframe
    })
  }

  func rects(at seconds: Double) -> PrivacyRects? {
    guard let first = keyframes.first else { return nil }
    if seconds <= first.seconds { return PrivacyRects(person: first.person, face: first.face) }
    guard let last = keyframes.last else { return nil }
    if seconds >= last.seconds { return PrivacyRects(person: last.person, face: last.face) }

    var low = 0
    var high = keyframes.count - 1
    while low + 1 < high {
      let middle = (low + high) / 2
      if keyframes[middle].seconds <= seconds { low = middle } else { high = middle }
    }
    let before = keyframes[low]
    let after = keyframes[high]
    let span = max(0.000_001, after.seconds - before.seconds)
    let fraction = CGFloat((seconds - before.seconds) / span)

    let person: NormalizedRect?
    if let a = before.person, let b = after.person {
      person = a.interpolated(to: b, fraction: fraction)
    } else {
      // Strict interpolation: never carry a stale box across a missed frame.
      person = nil
    }
    let face: NormalizedRect?
    if person != nil, let a = before.face, let b = after.face {
      face = a.interpolated(to: b, fraction: fraction)
    } else {
      face = nil
    }
    return PrivacyRects(person: person, face: face)
  }
}

private final class RTMPoseVideoScanner {
  private let asset: AVURLAsset
  private let progress: (Double) -> Void
  private let isCancelled: () -> Bool
  private let ciContext = CIContext(options: [.cacheIntermediates: false])

  init(
    asset: AVURLAsset,
    progress: @escaping (Double) -> Void,
    isCancelled: @escaping () -> Bool
  ) {
    self.asset = asset
    self.progress = progress
    self.isCancelled = isCancelled
  }

  func scan() throws -> PoseTimeline {
    let duration = CMTimeGetSeconds(asset.duration)
    guard duration.isFinite, duration > 0 else {
      throw Self.error(21, "The recording duration could not be read.")
    }
    guard let track = asset.tracks(withMediaType: .video).first else {
      throw Self.error(22, "The recording does not contain a video track.")
    }

    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(
      track: track,
      outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
      ]
    )
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else {
      throw Self.error(23, "The recording frames could not be decoded for pose estimation.")
    }
    reader.add(output)
    guard reader.startReading() else {
      throw reader.error ?? Self.error(24, "The recording pose scan could not start.")
    }

    let engine = try RTMPoseEngine()
    var keyframes: [PoseKeyframe] = []
    while let sample = output.copyNextSampleBuffer() {
      if isCancelled() {
        reader.cancelReading()
        throw Self.cancelledError()
      }
      guard let pixelBuffer = CMSampleBufferGetImageBuffer(sample) else { continue }
      let image = try displayImage(pixelBuffer: pixelBuffer, transform: track.preferredTransform)
      let landmarks = try engine.analyze(image)
      let seconds = max(0, CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)))
      let person = landmarks.flatMap(personRect)
      let frameAspect = CGFloat(image.width) / CGFloat(max(1, image.height))
      keyframes.append(PoseKeyframe(
        seconds: seconds,
        person: person,
        face: landmarks.flatMap { points in
          person.flatMap { faceRect(from: points, person: $0, frameAspect: frameAspect) }
        }
      ))
      progress(scanProgressShare * min(1, seconds / duration))
    }

    if reader.status == .failed {
      throw reader.error ?? Self.error(25, "The recording pose scan failed.")
    }
    guard !keyframes.isEmpty else {
      throw Self.error(26, "No video frames could be decoded for pose estimation.")
    }
    progress(scanProgressShare)
    return PoseTimeline(keyframes: keyframes.sorted { $0.seconds < $1.seconds })
  }

  private func displayImage(pixelBuffer: CVPixelBuffer, transform: CGAffineTransform) throws -> CGImage {
    let transformed = CIImage(cvPixelBuffer: pixelBuffer).transformed(by: transform)
    let extent = transformed.extent.integral
    let displayImage = transformed.transformed(
      by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY)
    )
    let displayExtent = CGRect(origin: .zero, size: extent.size)
    guard let image = ciContext.createCGImage(displayImage, from: displayExtent) else {
      throw Self.error(27, "A display-oriented video frame could not be created.")
    }
    return image
  }

  private func personRect(from landmarks: [RTMPosePoint]) -> NormalizedRect? {
    let points = landmarks.compactMap { normalizedPoint($0) }
    guard points.count >= 6 else { return nil }
    let bounds = bounds(of: points)
    guard bounds.width >= 0.10, bounds.height >= 0.15,
          bounds.width * bounds.height >= 0.02 else { return nil }
    return NormalizedRect(
      left: max(0, bounds.left - max(0.10, bounds.width * 0.32)),
      top: max(0, bounds.top - max(0.08, bounds.height * 0.22)),
      right: min(1, bounds.right + max(0.10, bounds.width * 0.32)),
      bottom: min(1, bounds.bottom + max(0.10, bounds.height * 0.18))
    )
  }

  private func faceRect(
    from landmarks: [RTMPosePoint],
    person: NormalizedRect,
    frameAspect: CGFloat
  ) -> NormalizedRect? {
    let facePoints = (0..<min(5, landmarks.count)).compactMap {
      normalizedPoint(landmarks[$0])
    }
    if facePoints.count >= 3 {
      let bounds = bounds(of: facePoints)
      let width = max(0.025, bounds.width)
      let height = max(0.035, bounds.height)
      return NormalizedRect(
        left: max(0, bounds.left - width * 0.40),
        top: max(0, bounds.top - height * 0.85),
        right: min(1, bounds.right + width * 0.40),
        bottom: min(1, bounds.bottom + height * 0.60)
      ).scaledHeight(2)
    }

    if landmarks.count > 6,
       let leftShoulder = normalizedPoint(landmarks[5], confidence: 0.10),
       let rightShoulder = normalizedPoint(landmarks[6], confidence: 0.10) {
      let shoulderWidth = max(0.04, abs(rightShoulder.x - leftShoulder.x))
      let headWidth = min(0.45, max(0.08, shoulderWidth * 0.68))
      let headHeight = min(0.42, max(0.08, headWidth * max(0.25, frameAspect) * 1.35))
      let centerX = (leftShoulder.x + rightShoulder.x) / 2
      let shoulderY = (leftShoulder.y + rightShoulder.y) / 2
      let bottom = min(1, shoulderY + headHeight * 0.12)
      return NormalizedRect(
        left: max(0, centerX - headWidth * 0.60),
        top: max(0, bottom - headHeight * 1.25),
        right: min(1, centerX + headWidth * 0.60),
        bottom: bottom
      ).scaledHeight(2)
    }

    let aspect = max(0.25, frameAspect)
    let headHeight = min(person.height * 0.34, max(0.08, person.width * aspect * 0.55))
    let headWidth = min(person.width * 0.65, max(0.08, headHeight / aspect))
    let centerX = (person.left + person.right) / 2
    return NormalizedRect(
      left: max(0, centerX - headWidth / 2),
      top: person.top,
      right: min(1, centerX + headWidth / 2),
      bottom: min(person.bottom, person.top + headHeight)
    ).scaledHeight(2)
  }

  private func normalizedPoint(
    _ point: RTMPosePoint,
    confidence: Float = RTMPoseEngine.landmarkThreshold
  ) -> CGPoint? {
    guard point.confidence >= confidence,
          point.x.isFinite, point.y.isFinite,
          point.x >= -0.1, point.x <= 1.1,
          point.y >= -0.1, point.y <= 1.1 else { return nil }
    return CGPoint(x: min(1, max(0, point.x)), y: min(1, max(0, point.y)))
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
  private let blurFaces: Bool
  private let blurBackground: Bool
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
    blurFaces: Bool,
    blurBackground: Bool,
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
    self.blurFaces = blurFaces
    self.blurBackground = blurBackground
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
        let detected = try RTMPoseVideoScanner(
          asset: asset,
          progress: self.progress,
          isCancelled: { [weak self] in self?.isCancelled ?? true }
        ).scan()
        let timeline = detected.filteredForBodyOutliers()
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
    guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
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
    exporter.exportAsynchronously { [weak self] in self?.finishExport() }
  }

  private func process(request: AVAsynchronousCIImageFilteringRequest, timeline: PoseTimeline) {
    stateLock.lock()
    let shouldCancel = cancelled
    let existingError = firstFrameError
    stateLock.unlock()
    if let existingError { request.finish(with: existingError); return }
    if shouldCancel { request.finish(with: Self.cancelledError()); return }

    do {
      let source = request.sourceImage
      let extent = source.extent.integral
      guard extent.width > 0, extent.height > 0 else {
        throw Self.error(4, "A video frame could not be decoded.")
      }
      guard let rects = timeline.rects(at: CMTimeGetSeconds(request.compositionTime)) else {
        throw Self.error(5, "No dense pose result was available for a video frame.")
      }

      let backgroundMosaicScale = max(24, min(extent.width, extent.height) / 24)
      let hardenedBackground = source
        .clampedToExtent()
        .applyingFilter(
          "CIPixellate",
          parameters: [
            kCIInputScaleKey: backgroundMosaicScale,
            kCIInputCenterKey: CIVector(x: extent.midX, y: extent.midY)
          ]
        )
        .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 24])
        .cropped(to: extent)

      var output = source
      if blurBackground {
        // Missing/rejected detections intentionally redact the entire frame.
        output = hardenedBackground
        if let normalizedPerson = rects.person {
          let person = normalizedPerson.coreImageRect(in: extent)
          guard !person.isEmpty else {
            throw Self.error(6, "The RTMPose person region was empty while blurring the background.")
          }
          let mask = CIImage(color: .white).cropped(to: person)
            .composited(over: CIImage(color: .black).cropped(to: extent))
            .applyingFilter(
              "CIGaussianBlur",
              parameters: [kCIInputRadiusKey: max(8, min(extent.width, extent.height) * 0.015)]
            )
            .cropped(to: extent)
          output = source.applyingFilter(
            "CIBlendWithMask",
            parameters: [
              kCIInputBackgroundImageKey: hardenedBackground,
              kCIInputMaskImageKey: mask
            ]
          )
        }
      }

      var faceWasDetected = false
      if blurFaces {
        if let normalizedFace = rects.face {
          let face = normalizedFace.coreImageRect(in: extent)
          if !face.isEmpty {
            let redacted = source
              .clampedToExtent()
              .applyingFilter(
                "CIPixellate",
                parameters: [
                  kCIInputScaleKey: max(14, min(face.width, face.height) / 4),
                  kCIInputCenterKey: CIVector(x: face.midX, y: face.midY)
                ]
              )
              .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 18])
              .cropped(to: face)
            output = redacted.composited(over: output)
            faceWasDetected = true
          }
        } else if !blurBackground {
          // Face-only mode must fail closed on a missed pose frame.
          output = hardenedBackground
        }
      }

      stateLock.lock()
      stats.framesProcessed += 1
      if faceWasDetected { stats.framesWithFaces += 1 }
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
      "poseSamples": finalTimeline?.poseSamples ?? 0,
      "totalPoseSamples": finalTimeline?.keyframes.count ?? 0,
      "faceSamples": finalTimeline?.faceSamples ?? 0,
      "detectorMode": "rtmdet_nano_rtmpose_t_coco17_dense"
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
        blurFaces: Bool,
        blurBackground: Bool,
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
          blurFaces: blurFaces,
          blurBackground: blurBackground,
          progress: { [weak self] value in
            DispatchQueue.main.async {
              self?.sendEvent(progressEvent, ["operationId": operationId, "progress": value])
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
