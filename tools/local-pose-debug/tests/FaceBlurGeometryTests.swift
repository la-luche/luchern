import CoreGraphics
import Foundation

private func assertRect(
  _ actual: CGRect,
  equals expected: CGRect,
  file: StaticString = #filePath,
  line: UInt = #line
) {
  let tolerance: CGFloat = 0.001
  precondition(abs(actual.minX - expected.minX) < tolerance, "x: \(actual) != \(expected)")
  precondition(abs(actual.minY - expected.minY) < tolerance, "y: \(actual) != \(expected)")
  precondition(abs(actual.width - expected.width) < tolerance, "width: \(actual) != \(expected)")
  precondition(abs(actual.height - expected.height) < tolerance, "height: \(actual) != \(expected)")
}

@main
private struct FaceBlurGeometryTests {
  static func main() {
    let normalized = NormalizedRect(left: 0.1, top: 0.2, right: 0.4, bottom: 0.6)

    assertRect(
      normalized.sourceImageRect(
        in: CGRect(x: 0, y: 0, width: 1920, height: 1080),
        preferredTransform: .identity
      ),
      equals: CGRect(x: 192, y: 432, width: 576, height: 432)
    )

    // The failing iPhone sample: 1280x720 encoded pixels displayed as 720x1280.
    assertRect(
      normalized.sourceImageRect(
        in: CGRect(x: 0, y: 0, width: 1280, height: 720),
        preferredTransform: CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 720, ty: 0)
      ),
      equals: CGRect(x: 512, y: 432, width: 512, height: 216)
    )

    // Also cover the opposite portrait rotation used by some imported videos.
    assertRect(
      normalized.sourceImageRect(
        in: CGRect(x: 0, y: 0, width: 1280, height: 720),
        preferredTransform: CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: 1280)
      ),
      equals: CGRect(x: 256, y: 72, width: 512, height: 216)
    )

    print("FaceBlurGeometryTests passed")
  }
}
