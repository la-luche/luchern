import CoreGraphics
import Foundation
import onnxruntime_objc

struct RTMPosePoint {
  let x: CGFloat
  let y: CGFloat
  let confidence: Float
}

private struct PixelImage {
  let width: Int
  let height: Int
  let bytes: [UInt8]

  init(_ image: CGImage) throws {
    width = image.width
    height = image.height
    var storage = [UInt8](repeating: 0, count: width * height * 4)
    guard let context = CGContext(
      data: &storage,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue |
        CGBitmapInfo.byteOrder32Big.rawValue
    ) else {
      throw RTMPoseError.message("A pose-estimation image buffer could not be created.")
    }
    context.interpolationQuality = .none
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    bytes = storage
  }

  /// Bilinear RGB sample. OpenCV's affine border value is black.
  func sample(x: Float, y: Float, border: UInt8 = 0) -> (Float, Float, Float) {
    let x0 = Int(floor(x))
    let y0 = Int(floor(y))
    let tx = x - Float(x0)
    let ty = y - Float(y0)

    func pixel(_ px: Int, _ py: Int) -> (Float, Float, Float) {
      guard px >= 0, py >= 0, px < width, py < height else {
        let value = Float(border)
        return (value, value, value)
      }
      let offset = (py * width + px) * 4
      return (
        Float(bytes[offset]),
        Float(bytes[offset + 1]),
        Float(bytes[offset + 2])
      )
    }

    let a = pixel(x0, y0)
    let b = pixel(x0 + 1, y0)
    let c = pixel(x0, y0 + 1)
    let d = pixel(x0 + 1, y0 + 1)
    let top = (
      a.0 + (b.0 - a.0) * tx,
      a.1 + (b.1 - a.1) * tx,
      a.2 + (b.2 - a.2) * tx
    )
    let bottom = (
      c.0 + (d.0 - c.0) * tx,
      c.1 + (d.1 - c.1) * tx,
      c.2 + (d.2 - c.2) * tx
    )
    return (
      top.0 + (bottom.0 - top.0) * ty,
      top.1 + (bottom.1 - top.1) * ty,
      top.2 + (bottom.2 - top.2) * ty
    )
  }
}

private struct DetectionBox {
  let left: Float
  let top: Float
  let right: Float
  let bottom: Float

  var area: Float { max(0, right - left) * max(0, bottom - top) }
}

private enum RTMPoseError: Error {
  case message(String)
}

extension RTMPoseError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .message(let message): return message
    }
  }
}

/**
 * Exact production implementation of local-pose-debug exp-0012:
 * RTMDet-nano person detection followed by RTMPose-t COCO-17.
 */
final class RTMPoseEngine {
  static let detectorThreshold: Float = 0.30
  static let landmarkThreshold: Float = 0.15

  private static let detectorWidth = 320
  private static let detectorHeight = 320
  private static let poseWidth = 192
  private static let poseHeight = 256
  private static let keypointCount = 17

  private let environment: ORTEnv
  private let detector: ORTSession
  private let pose: ORTSession

  init() throws {
    let detectorPath = try Self.modelPath(named: "rtmdet_nano_person_320")
    let posePath = try Self.modelPath(named: "rtmpose_t_coco17_256x192")
    environment = try ORTEnv(loggingLevel: .warning)
    detector = try ORTSession(env: environment, modelPath: detectorPath, sessionOptions: nil)
    pose = try ORTSession(env: environment, modelPath: posePath, sessionOptions: nil)
  }

  func analyze(_ image: CGImage) throws -> [RTMPosePoint]? {
    let pixels = try PixelImage(image)
    guard let box = try detectLargestPerson(in: pixels) else { return nil }
    return try estimatePose(in: pixels, box: box)
  }

  private func detectLargestPerson(in image: PixelImage) throws -> DetectionBox? {
    let ratio = min(
      Float(Self.detectorHeight) / Float(image.height),
      Float(Self.detectorWidth) / Float(image.width)
    )
    let resizedWidth = Int(Float(image.width) * ratio)
    let resizedHeight = Int(Float(image.height) * ratio)
    var input = [Float](
      repeating: 0,
      count: 3 * Self.detectorWidth * Self.detectorHeight
    )
    let plane = Self.detectorWidth * Self.detectorHeight
    let mean: [Float] = [103.53, 116.28, 123.675]
    let std: [Float] = [57.375, 57.12, 58.395]

    for y in 0..<Self.detectorHeight {
      for x in 0..<Self.detectorWidth {
        let rgb: (Float, Float, Float)
        if x < resizedWidth, y < resizedHeight {
          let sourceX = (Float(x) + 0.5) / ratio - 0.5
          let sourceY = (Float(y) + 0.5) / ratio - 0.5
          rgb = image.sample(x: sourceX, y: sourceY, border: 114)
        } else {
          rgb = (114, 114, 114)
        }
        let index = y * Self.detectorWidth + x
        let bgr = [rgb.2, rgb.1, rgb.0]
        for channel in 0..<3 {
          input[channel * plane + index] = (bgr[channel] - mean[channel]) / std[channel]
        }
      }
    }

    let value = try Self.tensor(input, shape: [1, 3, 320, 320])
    let outputs = try detector.run(
      withInputs: ["input": value],
      outputNames: ["dets"],
      runOptions: nil
    )
    guard let dets = outputs["dets"] else {
      throw RTMPoseError.message("RTMDet did not return its detection tensor.")
    }
    let shape = try dets.tensorTypeAndShapeInfo().shape.map(\.intValue)
    guard shape.count == 3, shape[2] == 5 else {
      throw RTMPoseError.message("RTMDet returned an unexpected detection shape: \(shape).")
    }
    let values: [Float] = try Self.array(from: dets)
    var largest: DetectionBox?
    for index in 0..<shape[1] {
      let offset = index * 5
      guard offset + 4 < values.count, values[offset + 4] > Self.detectorThreshold else {
        continue
      }
      let box = DetectionBox(
        left: max(0, min(Float(image.width - 1), values[offset] / ratio)),
        top: max(0, min(Float(image.height - 1), values[offset + 1] / ratio)),
        right: max(0, min(Float(image.width - 1), values[offset + 2] / ratio)),
        bottom: max(0, min(Float(image.height - 1), values[offset + 3] / ratio))
      )
      if box.area > (largest?.area ?? 0) { largest = box }
    }
    return largest
  }

  private func estimatePose(in image: PixelImage, box: DetectionBox) throws -> [RTMPosePoint] {
    let centerX = (box.left + box.right) * 0.5
    let centerY = (box.top + box.bottom) * 0.5
    var scaleWidth = (box.right - box.left) * 1.25
    var scaleHeight = (box.bottom - box.top) * 1.25
    let aspect = Float(Self.poseWidth) / Float(Self.poseHeight)
    if scaleWidth > scaleHeight * aspect {
      scaleHeight = scaleWidth / aspect
    } else {
      scaleWidth = scaleHeight * aspect
    }

    var input = [Float](repeating: 0, count: 3 * Self.poseWidth * Self.poseHeight)
    let plane = Self.poseWidth * Self.poseHeight
    let mean: [Float] = [123.675, 116.28, 103.53]
    let std: [Float] = [58.395, 57.12, 57.375]
    for y in 0..<Self.poseHeight {
      for x in 0..<Self.poseWidth {
        let sourceX = centerX + (Float(x) - Float(Self.poseWidth) * 0.5) *
          scaleWidth / Float(Self.poseWidth)
        let sourceY = centerY + (Float(y) - Float(Self.poseHeight) * 0.5) *
          scaleHeight / Float(Self.poseHeight)
        let rgb = image.sample(x: sourceX, y: sourceY)
        let index = y * Self.poseWidth + x
        let bgr = [rgb.2, rgb.1, rgb.0]
        for channel in 0..<3 {
          input[channel * plane + index] = (bgr[channel] - mean[channel]) / std[channel]
        }
      }
    }

    let value = try Self.tensor(input, shape: [1, 3, 256, 192])
    let outputs = try pose.run(
      withInputs: ["input": value],
      outputNames: ["simcc_x", "simcc_y"],
      runOptions: nil
    )
    guard let xValue = outputs["simcc_x"], let yValue = outputs["simcc_y"] else {
      throw RTMPoseError.message("RTMPose did not return both SimCC tensors.")
    }
    let xShape = try xValue.tensorTypeAndShapeInfo().shape.map(\.intValue)
    let yShape = try yValue.tensorTypeAndShapeInfo().shape.map(\.intValue)
    guard xShape.count == 3, yShape.count == 3,
          xShape[1] == Self.keypointCount, yShape[1] == Self.keypointCount else {
      throw RTMPoseError.message("RTMPose returned unexpected SimCC tensor shapes.")
    }
    let xValues: [Float] = try Self.array(from: xValue)
    let yValues: [Float] = try Self.array(from: yValue)
    let xBins = xShape[2]
    let yBins = yShape[2]

    return (0..<Self.keypointCount).map { keypoint in
      let xRange = (keypoint * xBins)..<((keypoint + 1) * xBins)
      let yRange = (keypoint * yBins)..<((keypoint + 1) * yBins)
      let xMaximum = xRange.max { xValues[$0] < xValues[$1] } ?? xRange.lowerBound
      let yMaximum = yRange.max { yValues[$0] < yValues[$1] } ?? yRange.lowerBound
      let modelX = Float(xMaximum - xRange.lowerBound) / 2
      let modelY = Float(yMaximum - yRange.lowerBound) / 2
      let originalX = modelX / Float(Self.poseWidth) * scaleWidth + centerX - scaleWidth / 2
      let originalY = modelY / Float(Self.poseHeight) * scaleHeight + centerY - scaleHeight / 2
      return RTMPosePoint(
        x: CGFloat(originalX / Float(max(1, image.width))),
        y: CGFloat(originalY / Float(max(1, image.height))),
        confidence: (xValues[xMaximum] + yValues[yMaximum]) * 0.5
      )
    }
  }

  private static func tensor(_ values: [Float], shape: [NSNumber]) throws -> ORTValue {
    let data = values.withUnsafeBufferPointer { Data(buffer: $0) }
    return try ORTValue(
      tensorData: NSMutableData(data: data),
      elementType: .float,
      shape: shape
    )
  }

  private static func array(from value: ORTValue) throws -> [Float] {
    let data = try value.tensorData() as Data
    guard data.count % MemoryLayout<Float>.stride == 0 else {
      throw RTMPoseError.message("An ONNX output tensor had an invalid byte count.")
    }
    return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
  }

  private static func modelPath(named name: String) throws -> String {
    let bundles = [Bundle.main, Bundle(for: RTMPoseEngine.self)] + Bundle.allFrameworks
    for bundle in bundles {
      if let path = bundle.path(forResource: name, ofType: "onnx") { return path }
    }
    throw RTMPoseError.message("The bundled \(name).onnx model could not be found.")
  }
}
