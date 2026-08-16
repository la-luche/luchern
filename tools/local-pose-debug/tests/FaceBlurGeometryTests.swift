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
      normalized.videoCompositionRect(
        in: CGRect(x: 0, y: 0, width: 1920, height: 1080)
      ),
      equals: CGRect(x: 192, y: 432, width: 576, height: 432)
    )

    // The failing iPhone sample is encoded as 1280x720 with a 90-degree
    // preferred transform. AVVideoComposition's filter callback has already
    // applied that transform, so its source and render extents are 720x1280.
    assertRect(
      normalized.videoCompositionRect(
        in: CGRect(x: 0, y: 0, width: 720, height: 1280)
      ),
      equals: CGRect(x: 72, y: 512, width: 216, height: 512)
    )

    print("FaceBlurGeometryTests passed")
  }
}
