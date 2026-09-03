import AVFoundation
import CoreImage
import ExpoModulesCore
import ImageIO

private let progressEvent = "onFaceBlurProgress"
private let scanProgressShare = 0.45

private struct PrivacyBlurStats {
  var framesProcessed = 0
  var framesWithFaces = 0
  var framesWithBackgroundBlur = 0
}

private struct PoseKeyframe {
  let seconds: Double
  let person: NormalizedRect?
  let face: NormalizedRect?
  let landmarks: [RTMPosePoint]?
}

private struct PrivacyRects {
  let person: NormalizedRect?
  let face: NormalizedRect?
}

private struct PoseTimeline {
  let keyframes: [PoseKeyframe]

  private static let reliabilityWindowSeconds = 0.5
  private static let visibleConfidence: Float = 0.5
  private static let minimumMedianVisibleJoints = 5.0
  private static let jumpConfidence: Float = 0.15
  private static let maximumResidualJumpP90 = 0.25

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
        return PoseKeyframe(
          seconds: keyframe.seconds,
          person: nil,
          face: nil,
          landmarks: keyframe.landmarks
        )
      }
      return keyframe
    })
  }

  /** Suppress every privacy box inside independently classified 0.5 s windows. */
  func filteredForUnreliableWindows() -> PoseTimeline {
    let grouped = Dictionary(grouping: keyframes) { keyframe in
      Int(floor((keyframe.seconds + 1e-9) / Self.reliabilityWindowSeconds))
    }
    let badWindows = Set(grouped.compactMap { index, frames in
      Self.isUnreliable(frames) ? index : nil
    })
    return PoseTimeline(keyframes: keyframes.map { keyframe in
      let index = Int(floor((keyframe.seconds + 1e-9) / Self.reliabilityWindowSeconds))
      guard badWindows.contains(index) else { return keyframe }
      return PoseKeyframe(
        seconds: keyframe.seconds,
        person: nil,
        face: nil,
        landmarks: keyframe.landmarks
      )
    })
  }

  private static func isUnreliable(_ frames: [PoseKeyframe]) -> Bool {
    let visibleCounts = frames.map { frame in
      Double(frame.landmarks?.filter { $0.confidence >= visibleConfidence }.count ?? 0)
    }
    guard let medianVisible = percentile(visibleCounts, quantile: 0.5),
          medianVisible < minimumMedianVisibleJoints,
          let residualJumpP90 = residualJumpP90(frames) else { return false }
    return residualJumpP90 > maximumResidualJumpP90
  }

  private static func residualJumpP90(_ frames: [PoseKeyframe]) -> Double? {
    var residuals: [Double] = []
    for (previous, current) in zip(frames, frames.dropFirst()) {
      guard let before = previous.landmarks, let after = current.landmarks,
            before.count == after.count else { continue }
      var displacements: [(dx: Double, dy: Double)] = []
      for index in before.indices {
        let first = before[index]
        let second = after[index]
        guard first.confidence >= jumpConfidence,
              second.confidence >= jumpConfidence,
              first.x.isFinite, first.y.isFinite,
              second.x.isFinite, second.y.isFinite else { continue }
        displacements.append((
          dx: Double(second.x - first.x),
          dy: Double(second.y - first.y)
        ))
      }
      guard displacements.count >= 2,
            let globalX = percentile(displacements.map { $0.dx }, quantile: 0.5),
            let globalY = percentile(displacements.map { $0.dy }, quantile: 0.5) else { continue }
      let scale = max(torsoScale(before), torsoScale(after))
      residuals.append(contentsOf: displacements.map { displacement in
        hypot(displacement.dx - globalX, displacement.dy - globalY) / scale
      })
    }
    return percentile(residuals, quantile: 0.9)
  }

  private static func torsoScale(_ points: [RTMPosePoint]) -> Double {
    guard points.count > 12 else { return 0.05 }
    func distance(_ first: Int, _ second: Int) -> Double {
      hypot(
        Double(points[first].x - points[second].x),
        Double(points[first].y - points[second].y)
      )
    }
    let shoulderMidX = Double(points[5].x + points[6].x) / 2
    let shoulderMidY = Double(points[5].y + points[6].y) / 2
    let hipMidX = Double(points[11].x + points[12].x) / 2
    let hipMidY = Double(points[11].y + points[12].y) / 2
    let values = [
      0.05,
      distance(5, 6),
      distance(11, 12),
      hypot(shoulderMidX - hipMidX, shoulderMidY - hipMidY),
    ].filter { $0.isFinite }
    return values.max() ?? 0.05
  }

  private static func percentile(_ values: [Double], quantile: Double) -> Double? {
    guard !values.isEmpty else { return nil }
    let sorted = values.sorted()
    let position = Double(sorted.count - 1) * min(1, max(0, quantile))
    let lower = Int(floor(position))
    let upper = Int(ceil(position))
    if lower == upper { return sorted[lower] }
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - Double(lower))
  }

  func nearestKeyframe(at seconds: Double) -> PoseKeyframe? {
    guard let first = keyframes.first else { return nil }
    if seconds <= first.seconds { return first }
    guard let last = keyframes.last else { return nil }
    if seconds >= last.seconds { return last }
    var low = 0
    var high = keyframes.count - 1
    while low + 1 < high {
      let middle = (low + high) / 2
      if keyframes[middle].seconds <= seconds { low = middle } else { high = middle }
    }
    return seconds - keyframes[low].seconds <= keyframes[high].seconds - seconds
      ? keyframes[low] : keyframes[high]
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
      let keyframe = try autoreleasepool { () throws -> PoseKeyframe in
        let image = try displayImage(
          pixelBuffer: pixelBuffer,
          transform: track.preferredTransform
        )
        let landmarks = try engine.analyze(image)
        let seconds = max(0, CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)))
        let person = landmarks.flatMap(personRect)
        return PoseKeyframe(
          seconds: seconds,
          person: person,
          face: landmarks.flatMap { points in
            person.flatMap { _ in faceRect(from: points) }
          },
          // Reliability gating needs the raw points even when diagnostics are hidden.
          landmarks: landmarks
        )
      }
      keyframes.append(keyframe)
      progress(scanProgressShare * min(1, keyframe.seconds / duration))
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
    // After the track's 90-degree preferred transform, CIContext's CGImage is
    // rotated 180 degrees relative to the top-left raster consumed by
    // RTMPoseEngine. Correct both axes so decoded frames match PNG/JPEG input.
    let topLeftImage = displayImage.transformed(
      by: CGAffineTransform(
        translationX: displayExtent.width,
        y: displayExtent.height
      ).scaledBy(x: -1, y: -1)
    )
    guard let image = ciContext.createCGImage(topLeftImage, from: displayExtent) else {
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

  private func faceRect(from landmarks: [RTMPosePoint]) -> NormalizedRect? {
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
      ).scaledHeight(2).extendedUpward(by: 0.20)
    }
    return nil
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
  private let showPoseOverlay: Bool
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

  /** Match OpenCV's automatic sigma when GaussianBlur is passed sigmaX=0. */
  private static func openCVGaussianSigma(forRequestedKernel requested: CGFloat) -> CGFloat {
    var kernel = max(3, Int(requested.rounded()))
    if kernel.isMultiple(of: 2) { kernel += 1 }
    return 0.3 * (CGFloat(kernel - 1) * 0.5 - 1) + 0.8
  }

  init(
    inputURL: URL,
    outputURL: URL,
    blurFaces: Bool,
    blurBackground: Bool,
    showPoseOverlay: Bool = false,
    progress: @escaping (Double) -> Void,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) throws {
    guard inputURL.isFileURL, outputURL.isFileURL else {
      throw Self.error(1, "Video privacy processing requires local file URLs.")
    }
    guard blurFaces || blurBackground || showPoseOverlay else {
      throw Self.error(2, "At least one video privacy option must be enabled.")
    }
    self.inputURL = inputURL
    self.outputURL = outputURL
    self.blurFaces = blurFaces
    self.blurBackground = blurBackground
    self.showPoseOverlay = showPoseOverlay
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
        let timeline = detected
          .filteredForBodyOutliers()
          .filteredForUnreliableWindows()
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

  private func process(
    request: AVAsynchronousCIImageFilteringRequest,
    timeline: PoseTimeline
  ) {
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

      var output = source
      var backgroundWasBlurred = false
      if blurBackground, let normalizedPerson = rects.person {
        let person = normalizedPerson.videoCompositionRect(in: extent)
        guard !person.isEmpty else {
          throw Self.error(6, "The RTMPose person region was empty while blurring the background.")
        }
        let backgroundMosaicScale = max(24, min(extent.width, extent.height) / 24)
        let backgroundBlurRadius = Self.openCVGaussianSigma(
          forRequestedKernel: min(extent.width, extent.height) * 0.055
        )
        let hardenedBackground = source
          .clampedToExtent()
          .applyingFilter(
            "CIPixellate",
            parameters: [
              kCIInputScaleKey: backgroundMosaicScale,
              kCIInputCenterKey: CIVector(x: extent.midX, y: extent.midY)
            ]
          )
          .applyingFilter(
            "CIGaussianBlur",
            parameters: [kCIInputRadiusKey: backgroundBlurRadius]
          )
          .cropped(to: extent)
        let mask = CIImage(color: .white).cropped(to: person)
          .composited(over: CIImage(color: .black).cropped(to: extent))
          .applyingFilter(
            "CIGaussianBlur",
            parameters: [
              kCIInputRadiusKey: Self.openCVGaussianSigma(
                forRequestedKernel: min(extent.width, extent.height) * 0.025
              )
            ]
          )
          .cropped(to: extent)
        output = source.applyingFilter(
          "CIBlendWithMask",
          parameters: [
            kCIInputBackgroundImageKey: hardenedBackground,
            kCIInputMaskImageKey: mask
          ]
        )
        backgroundWasBlurred = true
      }

      var faceWasDetected = false
      if blurFaces, rects.person != nil {
        if let normalizedFace = rects.face {
          let face = normalizedFace.videoCompositionRect(in: extent)
          if !face.isEmpty {
            let faceMosaicScale = max(1, face.width / 4)
            let faceBlurRadius = Self.openCVGaussianSigma(
              forRequestedKernel: min(face.width, face.height) * 0.18
            )
            let redacted = source
              .clampedToExtent()
              .applyingFilter(
                "CIPixellate",
                parameters: [
                  kCIInputScaleKey: faceMosaicScale,
                  kCIInputCenterKey: CIVector(x: face.midX, y: face.midY)
                ]
              )
              .applyingFilter(
                "CIGaussianBlur",
                parameters: [kCIInputRadiusKey: faceBlurRadius]
              )
              .cropped(to: face)
            output = redacted.composited(over: output)
            faceWasDetected = true
          }
        }
      }


      if showPoseOverlay, let keyframe = timeline.nearestKeyframe(
        at: CMTimeGetSeconds(request.compositionTime)
      ) {
        output = poseOverlay(over: output, keyframe: keyframe, extent: extent)
      }

      stateLock.lock()
      stats.framesProcessed += 1
      if faceWasDetected { stats.framesWithFaces += 1 }
      if backgroundWasBlurred { stats.framesWithBackgroundBlur += 1 }
      stateLock.unlock()
      request.finish(with: output.cropped(to: extent), context: ciContext)
    } catch {
      stateLock.lock()
      if firstFrameError == nil { firstFrameError = error }
      stateLock.unlock()
      request.finish(with: error)
    }
  }


  private func poseOverlay(
    over image: CIImage,
    keyframe: PoseKeyframe,
    extent: CGRect
  ) -> CIImage {
    var output = image

    func compositeBar(_ rect: CGRect, color: CIColor) {
      let clipped = rect.intersection(extent)
      guard !clipped.isEmpty, !clipped.isNull else { return }
      output = CIImage(color: color).cropped(to: clipped)
        .composited(over: output)
    }

    func outline(_ normalized: NormalizedRect?, color: CIColor, width: CGFloat) {
      guard let normalized else { return }
      let rect = normalized.videoCompositionRect(in: extent)
      guard !rect.isEmpty else { return }
      compositeBar(CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: width), color: color)
      compositeBar(CGRect(x: rect.minX, y: rect.maxY - width, width: rect.width, height: width), color: color)
      compositeBar(CGRect(x: rect.minX, y: rect.minY, width: width, height: rect.height), color: color)
      compositeBar(CGRect(x: rect.maxX - width, y: rect.minY, width: width, height: rect.height), color: color)
    }

    outline(keyframe.person, color: CIColor(red: 0, green: 0.85, blue: 1, alpha: 0.95), width: 4)
    outline(keyframe.face, color: CIColor(red: 1, green: 0.1, blue: 0.85, alpha: 0.95), width: 4)

    for point in keyframe.landmarks ?? [] where point.x.isFinite && point.y.isFinite {
      let x = extent.minX + CGFloat(point.x) * extent.width
      let y = extent.minY + (1 - CGFloat(point.y)) * extent.height
      let confidence = CGFloat(min(1, max(0, point.confidence)))
      let size: CGFloat = 10
      compositeBar(
        CGRect(x: x - size / 2, y: y - size / 2, width: size, height: size),
        color: CIColor(red: 1 - confidence, green: confidence, blue: 0.05, alpha: 0.98)
      )
    }
    return output
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

    AsyncFunction("excludeFromBackupAsync") { (inputURL: URL) in
      var url = inputURL
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }

    AsyncFunction("renderPoseOverlayVideoAsync") {
      (inputURL: URL, outputURL: URL, operationId: String, promise: Promise) in
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
          blurFaces: false,
          blurBackground: false,
          showPoseOverlay: true,
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

    AsyncFunction("diagnoseImageAsync") {
      (inputURL: URL, outputDirectory: URL, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          guard inputURL.isFileURL, outputDirectory.isFileURL else {
            throw NSError(
              domain: "FaceBlur",
              code: 40,
              userInfo: [NSLocalizedDescriptionKey: "Pose diagnostics require local file URLs."]
            )
          }
          guard let source = CGImageSourceCreateWithURL(inputURL as CFURL, nil),
                let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw NSError(
              domain: "FaceBlur",
              code: 41,
              userInfo: [NSLocalizedDescriptionKey: "The diagnostic image could not be decoded."]
            )
          }
          let points = try RTMPoseEngine().analyze(
            image,
            diagnosticsDirectory: outputDirectory
          )
          promise.resolve([
            "imageWidth": image.width,
            "imageHeight": image.height,
            "keypointCount": points?.count ?? 0,
            "outputDirectory": outputDirectory.absoluteString
          ])
        } catch {
          promise.reject("ERR_FACE_BLUR_DIAGNOSTICS", error.localizedDescription)
        }
      }
    }

    AsyncFunction("diagnoseVideoRectsAsync") {
      (inputURL: URL, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          guard inputURL.isFileURL else {
            throw NSError(
              domain: "FaceBlur",
              code: 42,
              userInfo: [NSLocalizedDescriptionKey: "Pose diagnostics require a local video URL."]
            )
          }
          let timeline = try RTMPoseVideoScanner(
            asset: AVURLAsset(url: inputURL),
            progress: { _ in },
            isCancelled: { false }
          ).scan()
            .filteredForBodyOutliers()
            .filteredForUnreliableWindows()
          let frames: [[String: Any]] = timeline.keyframes.enumerated().map { index, keyframe in
            func values(_ rect: NormalizedRect?) -> [Double]? {
              guard let rect else { return nil }
              return [
                Double(rect.left), Double(rect.top),
                Double(rect.right), Double(rect.bottom)
              ]
            }
            return [
              "frameIndex": index,
              "seconds": keyframe.seconds,
              "person": values(keyframe.person) as Any,
              "face": values(keyframe.face) as Any,
              "keypoints": keyframe.landmarks?.map { point in
                [Double(point.x), Double(point.y), Double(point.confidence)]
              } as Any
            ]
          }
          promise.resolve(["frames": frames])
        } catch {
          promise.reject("ERR_FACE_BLUR_DIAGNOSTIC", error.localizedDescription)
        }
      }
    }
  }
}
