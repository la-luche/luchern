package expo.modules.faceblur

import ai.quickpose.core.Feature
import ai.quickpose.core.Landmarks
import ai.quickpose.core.QuickPose
import ai.quickpose.core.Side
import ai.quickpose.core.Status
import ai.quickpose.core.Style
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.opengl.GLES20
import android.os.Handler
import android.os.Looper
import android.util.Size as AndroidSize
import android.view.Surface
import androidx.media3.common.C
import androidx.media3.common.GlTextureInfo
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlRect
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.ByteBufferGlEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val PROGRESS_EVENT = "onFaceBlurProgress"
private const val SCAN_PROGRESS_SHARE = 0.45
private const val MAXIMUM_POSE_DIMENSION = 512
private const val ADDITIONAL_FACE_PADDING_PER_EDGE = 0.20f

/** Normalized top-left coordinates, matching QuickPose/MediaPipe landmarks. */
private data class PrivacyRect(
  val left: Float,
  val top: Float,
  val right: Float,
  val bottom: Float,
) {
  val width: Float get() = max(0f, right - left)
  val height: Float get() = max(0f, bottom - top)

  fun interpolate(other: PrivacyRect, fraction: Float): PrivacyRect {
    val t = fraction.coerceIn(0f, 1f)
    return PrivacyRect(
      left = left + (other.left - left) * t,
      top = top + (other.top - top) * t,
      right = right + (other.right - right) * t,
      bottom = bottom + (other.bottom - bottom) * t,
    )
  }

  fun toGlRect(): GlPrivacyRect = GlPrivacyRect(
    left = left,
    bottom = 1f - bottom,
    right = right,
    top = 1f - top,
  )
}

private data class GlPrivacyRect(
  val left: Float,
  val bottom: Float,
  val right: Float,
  val top: Float,
)

private data class PoseKeyframe(
  val presentationTimeUs: Long,
  val person: PrivacyRect?,
  val face: PrivacyRect?,
)

private data class PrivacyRects(
  val person: PrivacyRect?,
  val face: PrivacyRect?,
)

private class PoseTimeline(val keyframes: List<PoseKeyframe>) {
  val poseSamples: Int get() = keyframes.count { it.person != null }
  val faceSamples: Int get() = keyframes.count { it.face != null }
  val isReliableForFace: Boolean get() = keyframes.isNotEmpty() &&
    faceSamples >= kotlin.math.ceil(keyframes.size * 0.4).toInt()
  val isReliableForBackground: Boolean get() {
    if (keyframes.isEmpty()) return false
    val minimumReliableSamples = kotlin.math.ceil(keyframes.size * 0.6).toInt()
    if (poseSamples < minimumReliableSamples) return false
    val reliableSamples = keyframes.count { keyframe ->
      val person = keyframe.person
      val face = keyframe.face
      if (person == null || face == null || person.width <= 0f || person.height <= 0f) {
        false
      } else {
        val bodyAspect = person.height / person.width
        val relativeFaceWidth = face.width / person.width
        bodyAspect >= 1.05f && relativeFaceWidth >= 0.10f
      }
    }
    return reliableSamples >= minimumReliableSamples
  }

  fun at(presentationTimeUs: Long): PrivacyRects? {
    val first = keyframes.firstOrNull() ?: return null
    if (presentationTimeUs <= first.presentationTimeUs) {
      return PrivacyRects(first.person, first.face)
    }
    val last = keyframes.last()
    if (presentationTimeUs >= last.presentationTimeUs) {
      return PrivacyRects(last.person, last.face)
    }

    var low = 0
    var high = keyframes.lastIndex
    while (low + 1 < high) {
      val middle = (low + high) / 2
      if (keyframes[middle].presentationTimeUs <= presentationTimeUs) low = middle else high = middle
    }
    val before = keyframes[low]
    val after = keyframes[high]
    val span = max(1L, after.presentationTimeUs - before.presentationTimeUs)
    val fraction = (presentationTimeUs - before.presentationTimeUs).toFloat() / span.toFloat()
    val person = when {
      before.person != null && after.person != null -> before.person.interpolate(after.person, fraction)
      fraction < 0.5f -> before.person
      else -> after.person
    }
    val face = when {
      before.face != null && after.face != null -> before.face.interpolate(after.face, fraction)
      fraction < 0.5f -> before.face
      else -> after.face
    }
    return PrivacyRects(person, face)
  }
}

private sealed interface CapturedPose {
  data class Found(val landmarks: Landmarks) : CapturedPose
  data object NoPerson : CapturedPose
  data object InvalidSdkKey : CapturedPose
}

/** Feeds sparse decoded bitmaps to QuickPose through its documented frame pipeline. */
private class QuickPoseBitmapBridge(
  context: Context,
  sdkKey: String,
  private val width: Int,
  private val height: Int,
) : AutoCloseable {
  private val quickPose = QuickPose(context, sdkKey)
  private val surfaceTexture = SurfaceTexture(false)
  private val surface = Surface(surfaceTexture)
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val stateLock = Any()
  private var pendingLatch: CountDownLatch? = null
  private var pendingResult: CapturedPose? = null

  init {
    surfaceTexture.setDefaultBufferSize(width, height)
    surfaceTexture.setOnFrameAvailableListener(quickPose, Handler(Looper.getMainLooper()))
    quickPose.onCameraStarted(false, AndroidSize(width, height), 1f)
    val started = CountDownLatch(1)
    quickPose.start(
      arrayOf(Feature.ShowPoints(Style())),
      onStart = { started.countDown() },
      onFrame = { status, _, _, _, landmarks ->
        val result = when (status) {
          is Status.Success -> landmarks?.let(CapturedPose::Found) ?: CapturedPose.NoPerson
          is Status.NoPersonFound -> CapturedPose.NoPerson
          is Status.SdkValidationError -> CapturedPose.InvalidSdkKey
        }
        val latch = synchronized(stateLock) {
          val waiting = pendingLatch
          if (waiting != null) {
            pendingResult = result
            pendingLatch = null
          }
          waiting
        }
        latch?.countDown()
      },
    )
    check(started.await(8, TimeUnit.SECONDS)) { "QuickPose did not become ready." }
  }

  fun analyze(bitmap: Bitmap): CapturedPose {
    repeat(2) { attempt ->
      val latch = CountDownLatch(1)
      synchronized(stateLock) {
        pendingResult = null
        pendingLatch = latch
      }
      val canvas = surface.lockCanvas(null)
      try {
        canvas.drawBitmap(bitmap, null, Rect(0, 0, width, height), paint)
      } finally {
        surface.unlockCanvasAndPost(canvas)
      }
      if (latch.await(8, TimeUnit.SECONDS)) {
        return synchronized(stateLock) {
          pendingResult.also { pendingResult = null } ?: CapturedPose.NoPerson
        }
      }
      synchronized(stateLock) { pendingLatch = null }
      if (attempt == 0) Thread.sleep(200)
    }
    throw IllegalStateException("QuickPose timed out while reading the recording.")
  }

  override fun close() {
    quickPose.stop()
    surface.release()
    surfaceTexture.release()
  }
}

private class QuickPoseVideoScanner(
  private val context: Context,
  private val inputUri: String,
  private val sdkKey: String,
  sampleIntervalMilliseconds: Int,
  private val onProgress: (Double) -> Unit,
  private val isCancelled: () -> Boolean,
) {
  private val sampleIntervalUs = sampleIntervalMilliseconds.coerceIn(100, 1_000) * 1_000L

  data class Result(val timeline: PoseTimeline, val durationUs: Long)

  fun scan(): Result {
    require(sdkKey.isNotBlank()) { "QuickPose SDK key is not configured for this build." }
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, Uri.parse(inputUri))
      val durationUs = (
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
          ?: 0L
      ) * 1_000L
      require(durationUs > 0) { "The recording duration could not be read." }

      val firstFrame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST)
        ?: throw IllegalStateException("The first video frame could not be decoded.")
      val target = scaledSize(firstFrame.width, firstFrame.height)
      val firstScaled = scale(firstFrame, target.first, target.second)
      if (firstScaled !== firstFrame) firstFrame.recycle()

      val sampleTimes = mutableListOf<Long>()
      var timeUs = 0L
      while (timeUs < durationUs) {
        sampleTimes += timeUs
        timeUs += sampleIntervalUs
      }
      val finalSample = max(0L, durationUs - 1_667L)
      if (sampleTimes.isEmpty() || finalSample - sampleTimes.last() > sampleIntervalUs / 3) {
        sampleTimes += finalSample
      }

      val keyframes = mutableListOf<PoseKeyframe>()
      QuickPoseBitmapBridge(context, sdkKey, target.first, target.second).use { bridge ->
        sampleTimes.forEachIndexed { index, requestedTimeUs ->
          if (isCancelled()) throw InterruptedException("Video privacy processing was cancelled.")
          val bitmap = if (index == 0) {
            firstScaled
          } else {
            val decoded = retriever.getFrameAtTime(
              requestedTimeUs,
              MediaMetadataRetriever.OPTION_CLOSEST,
            ) ?: return@forEachIndexed
            val scaled = scale(decoded, target.first, target.second)
            if (scaled !== decoded) decoded.recycle()
            scaled
          }
          try {
            when (val captured = bridge.analyze(bitmap)) {
              is CapturedPose.Found -> {
                val person = personRect(captured.landmarks)
                keyframes += PoseKeyframe(
                  presentationTimeUs = requestedTimeUs,
                  person = person,
                  face = if (person == null) null else faceRect(captured.landmarks),
                )
              }
              CapturedPose.InvalidSdkKey -> throw IllegalArgumentException(
                "The QuickPose SDK key is not valid for this app.",
              )
              CapturedPose.NoPerson -> keyframes += PoseKeyframe(
                presentationTimeUs = requestedTimeUs,
                person = null,
                face = null,
              )
            }
          } finally {
            bitmap.recycle()
          }
          onProgress(SCAN_PROGRESS_SHARE * (index + 1).toDouble() / sampleTimes.size.toDouble())
        }
      }

      require(keyframes.any { it.person != null }) {
        "QuickPose could not detect a person in this recording."
      }
      return Result(PoseTimeline(keyframes.sortedBy { it.presentationTimeUs }), durationUs)
    } finally {
      retriever.release()
    }
  }

  private fun scaledSize(width: Int, height: Int): Pair<Int, Int> {
    val scale = min(1f, MAXIMUM_POSE_DIMENSION.toFloat() / max(width, height).toFloat())
    return Pair(
      max(1, (width * scale).roundToInt()),
      max(1, (height * scale).roundToInt()),
    )
  }

  private fun scale(bitmap: Bitmap, width: Int, height: Int): Bitmap =
    if (bitmap.width == width && bitmap.height == height) bitmap
    else Bitmap.createScaledBitmap(bitmap, width, height, true)

  private fun personRect(landmarks: Landmarks): PrivacyRect? {
    val points = landmarks.allLandmarksForBody().mapNotNull { point ->
      if (point.visibility < 0.25f || point.presence < 0.25f) return@mapNotNull null
      val projected = point.cgPoint(AndroidSize(1, 1), false)
      if (!projected.x.isFinite() || !projected.y.isFinite()) return@mapNotNull null
      if (projected.x !in -0.1f..1.1f || projected.y !in -0.1f..1.1f) return@mapNotNull null
      Pair(projected.x.coerceIn(0f, 1f), projected.y.coerceIn(0f, 1f))
    }
    if (points.size < 6) return null
    val bounds = bounds(points)
    val width = max(0.05f, bounds.right - bounds.left)
    val height = max(0.1f, bounds.bottom - bounds.top)
    return PrivacyRect(
      left = (bounds.left - max(0.10f, width * 0.32f)).coerceIn(0f, 1f),
      top = (bounds.top - max(0.08f, height * 0.22f)).coerceIn(0f, 1f),
      right = (bounds.right + max(0.10f, width * 0.32f)).coerceIn(0f, 1f),
      bottom = (bounds.bottom + max(0.10f, height * 0.18f)).coerceIn(0f, 1f),
    )
  }

  private fun faceRect(landmarks: Landmarks): PrivacyRect? {
    val joints: List<Landmarks.Body> = listOf(
      Landmarks.Body.Nose(),
      Landmarks.Body.EyeInner(Side.LEFT), Landmarks.Body.Eye(Side.LEFT),
      Landmarks.Body.EyeOuter(Side.LEFT), Landmarks.Body.EyeInner(Side.RIGHT),
      Landmarks.Body.Eye(Side.RIGHT), Landmarks.Body.EyeOuter(Side.RIGHT),
      Landmarks.Body.Ear(Side.LEFT), Landmarks.Body.Ear(Side.RIGHT),
      Landmarks.Body.Mouth(Side.LEFT), Landmarks.Body.Mouth(Side.RIGHT),
    )
    val points = joints.mapNotNull { joint ->
      val point = landmarks.landmarkForBody(joint)
      if (point.visibility < 0.25f || point.presence < 0.25f) return@mapNotNull null
      val projected = point.cgPoint(AndroidSize(1, 1), false)
      if (!projected.x.isFinite() || !projected.y.isFinite()) return@mapNotNull null
      Pair(projected.x.coerceIn(0f, 1f), projected.y.coerceIn(0f, 1f))
    }
    if (points.size < 3) return null
    val bounds = bounds(points)
    val width = max(0.025f, bounds.right - bounds.left)
    val height = max(0.035f, bounds.bottom - bounds.top)
    // Production-video review found the prior face mask too tight. Expand
    // every edge by another 20% of the measured head width/height while
    // preserving the existing asymmetric forehead/chin padding.
    return PrivacyRect(
      left = (
        bounds.left - width * (0.20f + ADDITIONAL_FACE_PADDING_PER_EDGE)
      ).coerceIn(0f, 1f),
      top = (
        bounds.top - height * (0.50f + ADDITIONAL_FACE_PADDING_PER_EDGE)
      ).coerceIn(0f, 1f),
      right = (
        bounds.right + width * (0.20f + ADDITIONAL_FACE_PADDING_PER_EDGE)
      ).coerceIn(0f, 1f),
      bottom = (
        bounds.bottom + height * (0.25f + ADDITIONAL_FACE_PADDING_PER_EDGE)
      ).coerceIn(0f, 1f),
    )
  }

  private fun bounds(points: List<Pair<Float, Float>>): PrivacyRect = PrivacyRect(
    left = points.minOf { it.first },
    top = points.minOf { it.second },
    right = points.maxOf { it.first },
    bottom = points.maxOf { it.second },
  )
}

private data class FrameResult(
  val face: GlPrivacyRect?,
  val person: GlPrivacyRect?,
)

@UnstableApi
private class PrivacyBlurGlProcessor(
  private val timeline: PoseTimeline,
  private val durationUs: Long,
  private val blurFaces: Boolean,
  private val blurBackground: Boolean,
  private val onProgress: (Double) -> Unit,
) : ByteBufferGlEffect.Processor<FrameResult> {
  private val framesProcessed = AtomicInteger(0)
  private val framesWithFaces = AtomicInteger(0)
  private val framesWithBackgroundBlur = AtomicInteger(0)
  private var inputWidth = 0
  private var inputHeight = 0
  private var scratchTexture = GlTextureInfo.UNSET
  private var glProgram: GlProgram? = null
  private var lastProgressTimestampUs = Long.MIN_VALUE

  override fun configure(inputWidth: Int, inputHeight: Int): Size {
    this.inputWidth = inputWidth
    this.inputHeight = inputHeight
    if (scratchTexture != GlTextureInfo.UNSET) scratchTexture.release()
    val textureId = GlUtil.createTexture(inputWidth, inputHeight, false)
    scratchTexture = GlTextureInfo(
      textureId,
      GlUtil.createFboForTexture(textureId),
      C.INDEX_UNSET,
      inputWidth,
      inputHeight,
    )
    if (glProgram == null) {
      glProgram = GlProgram(VERTEX_SHADER, FRAGMENT_SHADER).apply {
        setBufferAttribute(
          "aFramePosition",
          GlUtil.getNormalizedCoordinateBounds(),
          GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE,
        )
      }
    }
    glProgram?.setFloatsUniform(
      "uResolution",
      floatArrayOf(inputWidth.toFloat(), inputHeight.toFloat()),
    )
    return Size(1, 1)
  }

  override fun getScaledRegion(presentationTimeUs: Long): GlRect = GlRect(inputWidth, inputHeight)

  override fun processImage(
    image: ByteBufferGlEffect.Image,
    presentationTimeUs: Long,
  ): ListenableFuture<FrameResult> {
    return try {
      val rects = timeline.at(presentationTimeUs)
        ?: throw IllegalStateException("No interpolated pose was available for a video frame.")
      framesProcessed.incrementAndGet()
      if (blurFaces && rects.face != null) framesWithFaces.incrementAndGet()
      if (blurBackground) framesWithBackgroundBlur.incrementAndGet()
      if (
        lastProgressTimestampUs == Long.MIN_VALUE ||
        presentationTimeUs - lastProgressTimestampUs >= 250_000
      ) {
        lastProgressTimestampUs = presentationTimeUs
        val exportFraction = if (durationUs > 0) {
          min(0.99, max(0.0, presentationTimeUs.toDouble() / durationUs.toDouble()))
        } else 0.0
        onProgress(SCAN_PROGRESS_SHARE + exportFraction * (0.99 - SCAN_PROGRESS_SHARE))
      }
      Futures.immediateFuture(FrameResult(rects.face?.toGlRect(), rects.person?.toGlRect()))
    } catch (error: Throwable) {
      Futures.immediateFailedFuture(error)
    }
  }

  override fun finishProcessingAndBlend(
    outputFrame: GlTextureInfo,
    presentationTimeUs: Long,
    result: FrameResult,
  ) {
    try {
      val fullFrame = GlRect(outputFrame.width, outputFrame.height)
      GlUtil.blitFrameBuffer(outputFrame.fboId, fullFrame, scratchTexture.fboId, fullFrame)
      GlUtil.focusFramebufferUsingCurrentContext(
        outputFrame.fboId,
        outputFrame.width,
        outputFrame.height,
      )
      val face = result.face
      glProgram?.apply {
        use()
        setSamplerTexIdUniform("uTexSampler", scratchTexture.texId, 0)
        setIntUniform("uBlurFaces", if (blurFaces && face != null) 1 else 0)
        setIntUniform("uBlurBackground", if (blurBackground) 1 else 0)
        setIntUniform("uHasPerson", if (result.person != null) 1 else 0)
        setFloatsUniform(
          "uFaceRect",
          if (face == null) floatArrayOf(0f, 0f, 0f, 0f)
          else floatArrayOf(face.left, face.bottom, face.right, face.top),
        )
        val person = result.person
        setFloatsUniform(
          "uPersonRect",
          if (person == null) floatArrayOf(0f, 0f, 0f, 0f)
          else floatArrayOf(person.left, person.bottom, person.right, person.top),
        )
        bindAttributesAndUniforms()
      }
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
      GlUtil.checkGlError()
    } catch (error: GlUtil.GlException) {
      throw VideoFrameProcessingException(error, presentationTimeUs)
    }
  }

  override fun release() {
    try {
      if (scratchTexture != GlTextureInfo.UNSET) scratchTexture.release()
      glProgram?.delete()
    } catch (error: GlUtil.GlException) {
      throw VideoFrameProcessingException(error)
    } finally {
      scratchTexture = GlTextureInfo.UNSET
      glProgram = null
    }
  }

  fun result(outputUri: String): Map<String, Any?> = mapOf(
    "outputUri" to outputUri,
    "framesProcessed" to framesProcessed.get(),
    "framesWithFaces" to framesWithFaces.get(),
    "framesWithBackgroundBlur" to framesWithBackgroundBlur.get(),
    "poseSamples" to timeline.poseSamples,
  )

  private companion object {
    const val VERTEX_SHADER = """
      attribute vec4 aFramePosition;
      varying vec2 vTexCoord;
      void main() {
        gl_Position = aFramePosition;
        vTexCoord = (aFramePosition.xy + 1.0) * 0.5;
      }
    """

    const val FRAGMENT_SHADER = """
      precision mediump float;
      uniform sampler2D uTexSampler;
      uniform vec2 uResolution;
      uniform int uBlurFaces;
      uniform int uBlurBackground;
      uniform int uHasPerson;
      uniform vec4 uFaceRect;
      uniform vec4 uPersonRect;
      varying vec2 vTexCoord;

      vec4 backgroundBlur(vec2 uv) {
        vec2 d = vec2(14.0) / uResolution;
        vec4 value = texture2D(uTexSampler, uv) * 0.20;
        value += texture2D(uTexSampler, uv + vec2(d.x, 0.0)) * 0.12;
        value += texture2D(uTexSampler, uv - vec2(d.x, 0.0)) * 0.12;
        value += texture2D(uTexSampler, uv + vec2(0.0, d.y)) * 0.12;
        value += texture2D(uTexSampler, uv - vec2(0.0, d.y)) * 0.12;
        value += texture2D(uTexSampler, uv + d) * 0.08;
        value += texture2D(uTexSampler, uv - d) * 0.08;
        value += texture2D(uTexSampler, uv + vec2(d.x, -d.y)) * 0.08;
        value += texture2D(uTexSampler, uv + vec2(-d.x, d.y)) * 0.08;
        return value;
      }

      float rectMask(vec2 uv, vec4 rect, float feather) {
        float horizontal = smoothstep(rect.x - feather, rect.x + feather, uv.x) *
          (1.0 - smoothstep(rect.z - feather, rect.z + feather, uv.x));
        float vertical = smoothstep(rect.y - feather, rect.y + feather, uv.y) *
          (1.0 - smoothstep(rect.w - feather, rect.w + feather, uv.y));
        return horizontal * vertical;
      }

      void main() {
        vec4 original = texture2D(uTexSampler, vTexCoord);
        vec4 color = original;
        if (uBlurBackground == 1) {
          float personMask = uHasPerson == 1
            ? rectMask(vTexCoord, uPersonRect, 0.015)
            : 0.0;
          color = mix(backgroundBlur(vTexCoord), original, personMask);
        }
        if (uBlurFaces == 1) {
          float faceMask = rectMask(vTexCoord, uFaceRect, 0.0005);
          vec2 block = max((uFaceRect.zw - uFaceRect.xy) / 7.0, 1.0 / uResolution);
          vec2 sampleCoord = uFaceRect.xy +
            (floor((vTexCoord - uFaceRect.xy) / block) + 0.5) * block;
          vec4 redacted = backgroundBlur(sampleCoord);
          color = mix(color, redacted, faceMask);
        }
        gl_FragColor = color;
      }
    """
  }
}

@UnstableApi
class FaceBlurModule : Module() {
  private class Operation(
    val outputFile: File,
    val promise: Promise,
  ) {
    val cancelled = AtomicBoolean(false)
    val settled = AtomicBoolean(false)
    @Volatile var transformer: Transformer? = null
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val operations = mutableMapOf<String, Operation>()

  override fun definition() = ModuleDefinition {
    Name("FaceBlur")
    Events(PROGRESS_EVENT)

    AsyncFunction("blurVideoAsync") {
        inputUri: String,
        outputUri: String,
        operationId: String,
        sdkKey: String,
        blurFaces: Boolean,
        blurBackground: Boolean,
        poseSampleIntervalMilliseconds: Int,
        promise: Promise,
      ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        promise.reject("ERR_FACE_BLUR", "Android application context is unavailable.", null)
        return@AsyncFunction
      }
      val input = localFile(inputUri)
      val output = localFile(outputUri)
      if (input == null || output == null) {
        promise.reject("ERR_FACE_BLUR", "Video privacy processing requires local file URLs.", null)
        return@AsyncFunction
      }
      if (!blurFaces && !blurBackground) {
        promise.reject("ERR_FACE_BLUR", "At least one video privacy option must be enabled.", null)
        return@AsyncFunction
      }

      mainHandler.post {
        if (operations.containsKey(operationId)) {
          promise.reject("ERR_FACE_BLUR_BUSY", "This recording is already being processed.", null)
          return@post
        }
        output.parentFile?.mkdirs()
        output.delete()
        val operation = Operation(output, promise)
        operations[operationId] = operation
        sendProgress(operationId, 0.0)

        Thread({
          try {
            val scan = QuickPoseVideoScanner(
              context = context,
              inputUri = inputUri,
              sdkKey = sdkKey,
              sampleIntervalMilliseconds = poseSampleIntervalMilliseconds,
              onProgress = { value -> sendProgress(operationId, value) },
              isCancelled = { operation.cancelled.get() },
            ).scan()
            if (blurFaces && !scan.timeline.isReliableForFace) {
              throw IllegalStateException(
                "QuickPose could not reliably locate a face in this recording.",
              )
            }
            if (blurBackground && !scan.timeline.isReliableForBackground) {
              throw IllegalStateException(
                "QuickPose could not reliably isolate one prominent full-body person for background blur.",
              )
            }
            if (operation.cancelled.get()) throw InterruptedException("cancelled")
            mainHandler.post {
              if (operation.cancelled.get()) return@post
              startTransformer(
                context,
                inputUri,
                outputUri,
                operationId,
                operation,
                scan,
                blurFaces,
                blurBackground,
              )
            }
          } catch (error: Throwable) {
            mainHandler.post {
              if (operation.cancelled.get()) {
                rejectCancelled(operationId, operation)
              } else {
                reject(operationId, operation, error)
              }
            }
          }
        }, "luche-quickpose-scan").start()
      }
    }

    AsyncFunction("cancelAsync") { operationId: String ->
      mainHandler.post {
        val operation = operations[operationId] ?: return@post
        operation.cancelled.set(true)
        operation.transformer?.cancel()
        operation.outputFile.delete()
        rejectCancelled(operationId, operation)
      }
    }
  }

  private fun startTransformer(
    context: Context,
    inputUri: String,
    outputUri: String,
    operationId: String,
    operation: Operation,
    scan: QuickPoseVideoScanner.Result,
    blurFaces: Boolean,
    blurBackground: Boolean,
  ) {
    val processor = PrivacyBlurGlProcessor(
      timeline = scan.timeline,
      durationUs = scan.durationUs,
      blurFaces = blurFaces,
      blurBackground = blurBackground,
      onProgress = { value -> sendProgress(operationId, value) },
    )
    try {
      val effect = ByteBufferGlEffect(processor)
      val editedMediaItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(inputUri)))
        .setEffects(Effects(emptyList(), listOf(effect)))
        .build()
      val transformer = Transformer.Builder(context)
        .setUsePlatformDiagnostics(false)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            if (!settle(operationId, operation)) {
              operation.outputFile.delete()
              return
            }
            sendProgress(operationId, 1.0)
            operation.promise.resolve(processor.result(outputUri))
          }

          override fun onError(
            composition: Composition,
            exportResult: ExportResult,
            exportException: ExportException,
          ) {
            reject(operationId, operation, exportException)
          }
        })
        .build()
      operation.transformer = transformer
      transformer.start(editedMediaItem, operation.outputFile.absolutePath)
    } catch (error: Throwable) {
      runCatching { processor.release() }
      reject(operationId, operation, error)
    }
  }

  private fun sendProgress(operationId: String, progress: Double) {
    mainHandler.post {
      sendEvent(PROGRESS_EVENT, mapOf(
        "operationId" to operationId,
        "progress" to progress.coerceIn(0.0, 1.0),
      ))
    }
  }

  private fun settle(operationId: String, operation: Operation): Boolean {
    if (!operation.settled.compareAndSet(false, true)) return false
    operations.remove(operationId)
    return true
  }

  private fun reject(operationId: String, operation: Operation, error: Throwable) {
    if (!settle(operationId, operation)) return
    operation.outputFile.delete()
    operation.promise.reject(
      "ERR_FACE_BLUR",
      error.localizedMessage ?: "Video privacy processing failed.",
      error,
    )
  }

  private fun rejectCancelled(operationId: String, operation: Operation) {
    if (!settle(operationId, operation)) return
    operation.outputFile.delete()
    operation.promise.reject(
      "ERR_FACE_BLUR_CANCELLED",
      "Video privacy processing was cancelled.",
      null,
    )
  }

  private fun localFile(uriString: String): File? {
    val uri = Uri.parse(uriString)
    if (uri.scheme != "file" || uri.path.isNullOrBlank()) return null
    return File(requireNotNull(uri.path))
  }
}
