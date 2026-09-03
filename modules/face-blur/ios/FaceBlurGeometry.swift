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

  /** Increase height by moving only the top edge; keep the bottom fixed. */
  func extendedUpward(by fraction: CGFloat) -> NormalizedRect {
    NormalizedRect(
      left: left,
      top: max(0, top - height * max(0, fraction)),
      right: right,
      bottom: bottom
    )
  }

  /**
   Maps a display-oriented, normalized top-left box into the Core Image frame.

   `AVVideoComposition(asset:applyingCIFiltersWithHandler:)` supplies its
   `sourceImage` in render orientation. For a portrait track stored as
   1280x720 with a 90-degree preferred transform, both `sourceImage.extent`
   and `request.renderSize` are already 720x1280. Applying the track transform
   again would rotate the privacy box a second time.
   */
  func videoCompositionRect(in extent: CGRect) -> CGRect {
    CGRect(
      x: extent.minX + left * extent.width,
      y: extent.minY + (1 - bottom) * extent.height,
      width: width * extent.width,
      height: height * extent.height
    ).intersection(extent)
  }

}
