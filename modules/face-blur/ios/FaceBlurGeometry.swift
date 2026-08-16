import CoreGraphics

/** Normalized top-left coordinates in the display-oriented video frame. */
struct NormalizedRect {
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

  /**
   Maps a display-oriented pose box back into the encoded Core Image frame.

   RTMPose receives the pixel buffer after `preferredTransform` and an origin
   normalization. AVVideoComposition supplies the untransformed pixel buffer,
   so privacy masks must reverse both operations before compositing.
   */
  func sourceImageRect(
    in sourceExtent: CGRect,
    preferredTransform: CGAffineTransform
  ) -> CGRect {
    let transformedExtent = sourceExtent.applying(preferredTransform).integral
    guard transformedExtent.width > 0, transformedExtent.height > 0 else { return .null }

    let displayExtent = CGRect(origin: .zero, size: transformedExtent.size)
    let displayRect = coreImageRect(in: displayExtent)
    let transformedRect = displayRect.offsetBy(
      dx: transformedExtent.minX,
      dy: transformedExtent.minY
    )
    return transformedRect
      .applying(preferredTransform.inverted())
      .standardized
      .intersection(sourceExtent)
  }
}
