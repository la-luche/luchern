import AVFoundation
import CoreImage
import CoreVideo
import ExpoModulesCore
import TensorFlowLiteC

private let progressEvent = "onFaceBlurProgress"
private let modelName = "luche_blaze_face_full_range"
private let maximumFaces = 8
private let detectorSize: CGFloat = 192
private let detectorSide = 192
private let anchorGridSide = 48
private let boxCount = 2304
private let boxValueCount = 16
private let minimumScore: Float = 0.45
private let nmsIouThreshold: CGFloat = 0.3

private struct FaceBlurStats {
  var framesProcessed = 0
  var framesWithFaces = 0
  var detections = 0
}

private struct DetectionBox {
  let left: CGFloat
  let top: CGFloat
  let right: CGFloat
  let bottom: CGFloat
  let score: Float
}

/** Direct BlazeFace TFLite runner. No MediaPipe Tasks telemetry is linked. */
private final class BlazeFaceDetector {
  private let model: OpaquePointer
  private let interpreter: OpaquePointer
  private let pixelBuffer: CVPixelBuffer
  private let colorSpace = CGColorSpaceCreateDeviceRGB()
  private var inputValues = [Float](repeating: 0, count: detectorSide * detectorSide * 3)
  private var rawBoxes = [Float](repeating: 0, count: boxCount * boxValueCount)
  private var rawScores = [Float](repeating: 0, count: boxCount)

  init(modelPath: String) throws {
    guard let createdModel = modelPath.withCString({ TfLiteModelCreateFromFile($0) }) else {
      throw Self.error(7, "The bundled face detector model could not be opened.")
    }
    guard let options = TfLiteInterpreterOptionsCreate() else {
      TfLiteModelDelete(createdModel)
      throw Self.error(7, "The face detector options could not be created.")
    }
    TfLiteInterpreterOptionsSetNumThreads(options, 2)
    guard let createdInterpreter = TfLiteInterpreterCreate(createdModel, options) else {
      TfLiteInterpreterOptionsDelete(options)
      TfLiteModelDelete(createdModel)
      throw Self.error(7, "The face detector could not be created.")
    }
    TfLiteInterpreterOptionsDelete(options)
    guard TfLiteInterpreterAllocateTensors(createdInterpreter) == kTfLiteOk else {
      TfLiteInterpreterDelete(createdInterpreter)
      TfLiteModelDelete(createdModel)
      throw Self.error(7, "The face detector tensors could not be allocated.")
    }
    model = createdModel
    interpreter = createdInterpreter

    var createdBuffer: CVPixelBuffer?
    let attributes: [CFString: Any] = [
      kCVPixelBufferCGImageCompatibilityKey: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey: true,
      kCVPixelBufferIOSurfacePropertiesKey: [:]
    ]
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault,
      detectorSide,
      detectorSide,
      kCVPixelFormatType_32BGRA,
      attributes as CFDictionary,
      &createdBuffer
    )
    guard status == kCVReturnSuccess, let createdBuffer else {
      throw NSError(
        domain: "FaceBlur",
        code: 7,
        userInfo: [NSLocalizedDescriptionKey: "The face detector image buffer could not be created."]
      )
    }
    pixelBuffer = createdBuffer
  }

  deinit {
    TfLiteInterpreterDelete(interpreter)
    TfLiteModelDelete(model)
  }

  func detect(image: CIImage, context: CIContext) throws -> [CGRect] {
    let bounds = CGRect(x: 0, y: 0, width: detectorSide, height: detectorSide)
    context.render(
      image,
      to: pixelBuffer,
      bounds: bounds,
      colorSpace: colorSpace
    )

    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
      throw NSError(
        domain: "FaceBlur",
        code: 8,
        userInfo: [NSLocalizedDescriptionKey: "The face detector image could not be read."]
      )
    }
    let bytes = baseAddress.assumingMemoryBound(to: UInt8.self)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    var valueIndex = 0
    for y in 0..<detectorSide {
      for x in 0..<detectorSide {
        let offset = y * bytesPerRow + x * 4
        inputValues[valueIndex] = Float(bytes[offset + 2]) / 127.5 - 1
        inputValues[valueIndex + 1] = Float(bytes[offset + 1]) / 127.5 - 1
        inputValues[valueIndex + 2] = Float(bytes[offset]) / 127.5 - 1
        valueIndex += 3
      }
    }

    guard let inputTensor = TfLiteInterpreterGetInputTensor(interpreter, 0) else {
      throw Self.error(9, "The face detector input tensor is missing.")
    }
    let copiedInput = inputValues.withUnsafeBufferPointer { buffer in
      TfLiteTensorCopyFromBuffer(
        inputTensor,
        buffer.baseAddress,
        buffer.count * MemoryLayout<Float>.size
      )
    }
    guard copiedInput == kTfLiteOk, TfLiteInterpreterInvoke(interpreter) == kTfLiteOk else {
      throw Self.error(9, "The face detector could not process this frame.")
    }
    guard let boxesTensor = TfLiteInterpreterGetOutputTensor(interpreter, 0),
          let scoresTensor = TfLiteInterpreterGetOutputTensor(interpreter, 1) else {
      throw Self.error(9, "The face detector output tensors are missing.")
    }
    let copiedBoxes = rawBoxes.withUnsafeMutableBufferPointer { buffer in
      TfLiteTensorCopyToBuffer(
        boxesTensor,
        buffer.baseAddress,
        buffer.count * MemoryLayout<Float>.size
      )
    }
    let copiedScores = rawScores.withUnsafeMutableBufferPointer { buffer in
      TfLiteTensorCopyToBuffer(
        scoresTensor,
        buffer.baseAddress,
        buffer.count * MemoryLayout<Float>.size
      )
    }
    guard copiedBoxes == kTfLiteOk, copiedScores == kTfLiteOk else {
      throw Self.error(9, "The face detector returned an invalid result.")
    }

    var candidates: [DetectionBox] = []
    candidates.reserveCapacity(32)
    for index in 0..<boxCount {
      let logit = min(100, max(-100, rawScores[index]))
      let score = 1 / (1 + exp(-logit))
      if score < minimumScore { continue }

      let offset = index * boxValueCount
      let anchorX = (CGFloat(index % anchorGridSide) + 0.5) / CGFloat(anchorGridSide)
      let anchorY = (CGFloat(index / anchorGridSide) + 0.5) / CGFloat(anchorGridSide)
      // MediaPipe's BlazeFace export uses reverse_output_order: y, x, h, w.
      let centerX = CGFloat(rawBoxes[offset + 1]) / detectorSize + anchorX
      let centerY = CGFloat(rawBoxes[offset]) / detectorSize + anchorY
      let width = CGFloat(rawBoxes[offset + 3]) / detectorSize
      let height = CGFloat(rawBoxes[offset + 2]) / detectorSize
      candidates.append(DetectionBox(
        left: centerX - width / 2,
        top: centerY - height / 2,
        right: centerX + width / 2,
        bottom: centerY + height / 2,
        score: score
      ))
    }

    var remaining = candidates.sorted(by: { $0.score > $1.score })
    var selected: [DetectionBox] = []
    while !remaining.isEmpty && selected.count < maximumFaces {
      let seed = remaining.removeFirst()
      var overlapping = [seed]
      remaining.removeAll { candidate in
        if intersectionOverUnion(seed, candidate) > nmsIouThreshold {
          overlapping.append(candidate)
          return true
        }
        return false
      }
      let scoreSum = overlapping.reduce(CGFloat.zero) { $0 + CGFloat($1.score) }
      selected.append(DetectionBox(
        left: overlapping.reduce(0) { $0 + $1.left * CGFloat($1.score) } / scoreSum,
        top: overlapping.reduce(0) { $0 + $1.top * CGFloat($1.score) } / scoreSum,
        right: overlapping.reduce(0) { $0 + $1.right * CGFloat($1.score) } / scoreSum,
        bottom: overlapping.reduce(0) { $0 + $1.bottom * CGFloat($1.score) } / scoreSum,
        score: seed.score
      ))
    }
    return selected.map { box in
      CGRect(
        x: box.left * detectorSize,
        y: box.top * detectorSize,
        width: (box.right - box.left) * detectorSize,
        height: (box.bottom - box.top) * detectorSize
      )
    }
  }

  private func intersectionOverUnion(_ a: DetectionBox, _ b: DetectionBox) -> CGFloat {
    let intersectionWidth = max(0, min(a.right, b.right) - max(a.left, b.left))
    let intersectionHeight = max(0, min(a.bottom, b.bottom) - max(a.top, b.top))
    let intersection = intersectionWidth * intersectionHeight
    let areaA = max(0, a.right - a.left) * max(0, a.bottom - a.top)
    let areaB = max(0, b.right - b.left) * max(0, b.bottom - b.top)
    let union = areaA + areaB - intersection
    return union > 0 ? intersection / union : 0
  }

  private static func error(_ code: Int, _ message: String) -> NSError {
    NSError(
      domain: "FaceBlur",
      code: code,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}

private final class FaceBlurProcessor {
  private let inputURL: URL
  private let outputURL: URL
  private let progress: (Double) -> Void
  private let completion: (Result<[String: Any], Error>) -> Void
  private let detector: BlazeFaceDetector
  private let detectorLock = NSLock()
  private let stateLock = NSLock()
  private let ciContext = CIContext(options: [.cacheIntermediates: false])
  private let detectorBackground = CIImage(
    color: CIColor(red: 0, green: 0, blue: 0, alpha: 1)
  ).cropped(to: CGRect(x: 0, y: 0, width: detectorSize, height: detectorSize))

  private var exportSession: AVAssetExportSession?
  private var progressTimer: DispatchSourceTimer?
  private var stats = FaceBlurStats()
  private var cancelled = false
  private var firstFrameError: Error?

  init(
    inputURL: URL,
    outputURL: URL,
    progress: @escaping (Double) -> Void,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) throws {
    guard inputURL.isFileURL, outputURL.isFileURL else {
      throw NSError(
        domain: "FaceBlur",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Face blurring requires local file URLs."]
      )
    }
    guard let modelPath = Bundle.main.path(forResource: modelName, ofType: "tflite") else {
      throw NSError(
        domain: "FaceBlur",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "The bundled face detector model is missing."]
      )
    }

    self.inputURL = inputURL
    self.outputURL = outputURL
    self.progress = progress
    self.completion = completion
    self.detector = try BlazeFaceDetector(modelPath: modelPath)
  }

  func start() {
    do {
      try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try? FileManager.default.removeItem(at: outputURL)

      let asset = AVURLAsset(url: inputURL)
      guard let exporter = AVAssetExportSession(
        asset: asset,
        presetName: AVAssetExportPresetHighestQuality
      ) else {
        throw NSError(
          domain: "FaceBlur",
          code: 3,
          userInfo: [NSLocalizedDescriptionKey: "This video cannot be prepared for face blurring."]
        )
      }

      let composition = AVVideoComposition(asset: asset) { [weak self] request in
        self?.process(request: request)
      }
      exporter.videoComposition = composition
      exporter.outputURL = outputURL
      exporter.outputFileType = .mp4
      exporter.shouldOptimizeForNetworkUse = true
      exportSession = exporter

      progress(0)
      startProgressTimer(exporter)
      exporter.exportAsynchronously { [weak self] in
        self?.finishExport()
      }
    } catch {
      completion(.failure(error))
    }
  }

  func cancel() {
    stateLock.lock()
    cancelled = true
    let exporter = exportSession
    stateLock.unlock()
    exporter?.cancelExport()
  }

  private func process(request: AVAsynchronousCIImageFilteringRequest) {
    stateLock.lock()
    let shouldCancel = cancelled
    let existingError = firstFrameError
    stateLock.unlock()
    if let existingError {
      request.finish(with: existingError)
      return
    }
    if shouldCancel {
      request.finish(with: NSError(
        domain: NSCocoaErrorDomain,
        code: NSUserCancelledError,
        userInfo: [NSLocalizedDescriptionKey: "Face blurring was cancelled."]
      ))
      return
    }

    do {
      let source = request.sourceImage
      let extent = source.extent.integral
      guard extent.width > 0, extent.height > 0 else {
        throw NSError(
          domain: "FaceBlur",
          code: 4,
          userInfo: [NSLocalizedDescriptionKey: "A video frame could not be decoded."]
        )
      }

      // Full-range BlazeFace consumes 192×192 input. Downsample on the GPU
      // before copying into the CPU TFLite buffer so old phones never allocate
      // a full-resolution CPU bitmap for every video frame.
      let normalized = source.transformed(by: CGAffineTransform(
        translationX: -extent.minX,
        y: -extent.minY
      ))
      // Match the official graph: aspect-preserving resize, centered with
      // zero-value letterbox padding, then project detections back afterward.
      let scale = min(detectorSize / extent.width, detectorSize / extent.height)
      let contentWidth = extent.width * scale
      let contentHeight = extent.height * scale
      let padX = (detectorSize - contentWidth) / 2
      let padY = (detectorSize - contentHeight) / 2
      let scaled = normalized.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
      let positioned = scaled.transformed(by: CGAffineTransform(
        translationX: padX,
        y: padY
      ))
      let detectorImage = positioned.composited(over: detectorBackground)
      let detectorContentRect = CGRect(
        x: padX,
        y: padY,
        width: contentWidth,
        height: contentHeight
      )
      detectorLock.lock()
      let detections: [CGRect]
      do {
        detections = try detector.detect(image: detectorImage, context: ciContext)
        detectorLock.unlock()
      } catch {
        detectorLock.unlock()
        throw error
      }

      var output = source
      for detected in detections {
        let expanded = expandedRect(
          detected,
          detectorContentRect: detectorContentRect,
          outputExtent: extent
        )
        guard !expanded.isEmpty else { continue }

        let mosaicScale = max(16, min(expanded.width, expanded.height) / 8)
        let redacted = source
          .clampedToExtent()
          .applyingFilter(
            "CIPixellate",
            parameters: [
              kCIInputScaleKey: mosaicScale,
              kCIInputCenterKey: CIVector(x: expanded.midX, y: expanded.midY)
            ]
          )
          .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 10])
          .cropped(to: expanded)
        output = redacted.composited(over: output)
      }

      stateLock.lock()
      stats.framesProcessed += 1
      if !detections.isEmpty { stats.framesWithFaces += 1 }
      stats.detections += detections.count
      stateLock.unlock()

      request.finish(with: output.cropped(to: extent), context: ciContext)
    } catch {
      stateLock.lock()
      if firstFrameError == nil { firstFrameError = error }
      stateLock.unlock()
      request.finish(with: error)
    }
  }

  private func expandedRect(
    _ box: CGRect,
    detectorContentRect: CGRect,
    outputExtent: CGRect
  ) -> CGRect {
    // BlazeFace boxes use top-left 192×192 coordinates. Core Image uses the
    // full-resolution output extent with a bottom-left origin.
    let horizontalPadding = box.width * 0.35
    let topPadding = box.height * 0.45
    let bottomPadding = box.height * 0.25
    let left = min(1, max(0, (
      box.minX - detectorContentRect.minX - horizontalPadding
    ) / detectorContentRect.width))
    let right = min(1, max(0, (
      box.maxX - detectorContentRect.minX + horizontalPadding
    ) / detectorContentRect.width))
    let top = min(1, max(0, (
      box.minY - detectorContentRect.minY - topPadding
    ) / detectorContentRect.height))
    let bottom = min(1, max(0, (
      box.maxY - detectorContentRect.minY + bottomPadding
    ) / detectorContentRect.height))
    let rect = CGRect(
      x: outputExtent.minX + left * outputExtent.width,
      y: outputExtent.minY + (1 - bottom) * outputExtent.height,
      width: (right - left) * outputExtent.width,
      height: (bottom - top) * outputExtent.height
    )
    return rect.intersection(outputExtent)
  }

  private func startProgressTimer(_ exporter: AVAssetExportSession) {
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now(), repeating: .milliseconds(250))
    timer.setEventHandler { [weak self, weak exporter] in
      guard let self, let exporter else { return }
      self.progress(min(0.99, max(0, Double(exporter.progress))))
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
    stateLock.unlock()

    guard let exporter = exportSession else { return }
    exportSession = nil

    if wasCancelled || exporter.status == .cancelled {
      try? FileManager.default.removeItem(at: outputURL)
      completion(.failure(NSError(
        domain: "FaceBlur",
        code: 5,
        userInfo: [NSLocalizedDescriptionKey: "Face blurring was cancelled."]
      )))
      return
    }
    if let error = frameError ?? exporter.error {
      try? FileManager.default.removeItem(at: outputURL)
      completion(.failure(error))
      return
    }
    guard exporter.status == .completed else {
      try? FileManager.default.removeItem(at: outputURL)
      completion(.failure(NSError(
        domain: "FaceBlur",
        code: 6,
        userInfo: [NSLocalizedDescriptionKey: "Face blurring did not finish."]
      )))
      return
    }

    progress(1)
    completion(.success([
      "outputUri": outputURL.absoluteString,
      "framesProcessed": finalStats.framesProcessed,
      "framesWithFaces": finalStats.framesWithFaces,
      "detections": finalStats.detections
    ]))
  }
}

public final class FaceBlurModule: Module {
  private let operationsLock = NSLock()
  private var operations: [String: FaceBlurProcessor] = [:]

  public func definition() -> ModuleDefinition {
    Name("FaceBlur")
    Events(progressEvent)

    AsyncFunction("blurVideoAsync") {
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
