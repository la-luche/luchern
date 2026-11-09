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
    // Expected top-left output coordinates for all four corners of a 4x6
    // encoded raster. Include upright, both quarter turns, upside down and
    // mirrored video: a blanket 180-degree correction fails these cases.
    let sourceExtent = CGRect(x: 0, y: 0, width: 4, height: 6)
    let sourceCorners = [
      CGPoint(x: 0, y: 6), CGPoint(x: 4, y: 6),
      CGPoint(x: 0, y: 0), CGPoint(x: 4, y: 0),
    ]
    let orientations: [(CGAffineTransform, [CGPoint])] = [
      (.identity, [CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0), CGPoint(x: 0, y: 1), CGPoint(x: 1, y: 1)]),
      (CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 6, ty: 0),
       [CGPoint(x: 1, y: 0), CGPoint(x: 1, y: 1), CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 1)]),
      (CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: 4),
       [CGPoint(x: 0, y: 1), CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 1), CGPoint(x: 1, y: 0)]),
      (CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: 4, ty: 6),
       [CGPoint(x: 1, y: 1), CGPoint(x: 0, y: 1), CGPoint(x: 1, y: 0), CGPoint(x: 0, y: 0)]),
      (CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: 4, ty: 0),
       [CGPoint(x: 1, y: 0), CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 1), CGPoint(x: 0, y: 1)]),
    ]
    for (trackTransform, expectedCorners) in orientations {
      let transform = privacyDisplayTransform(trackTransform, sourceExtent: sourceExtent)
      let extent = sourceExtent.applying(transform)
      for (corner, expected) in zip(sourceCorners, expectedCorners) {
        let actual = corner.applying(transform)
        precondition(abs((actual.x - extent.minX) / extent.width - expected.x) < 0.001)
        precondition(abs(1 - (actual.y - extent.minY) / extent.height - expected.y) < 0.001)
      }
    }

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

    let extended = normalized.extendedUpward(by: 0.20)
    precondition(abs(extended.top - 0.12) < 0.001)
    precondition(abs(extended.bottom - normalized.bottom) < 0.001)
    precondition(abs(extended.height - normalized.height * 1.20) < 0.001)

    print("FaceBlurGeometryTests passed")
  }
}
