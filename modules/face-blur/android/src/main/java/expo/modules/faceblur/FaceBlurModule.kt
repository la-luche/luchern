package expo.modules.faceblur

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.opengl.GLES20
import android.os.Build
import android.os.Handler
import android.os.Looper
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
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private const val PROGRESS_EVENT = "onFaceBlurProgress"
private const val SCAN_PROGRESS_SHARE = 0.45

/** Normalized top-left coordinates. */
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

  fun scaledHeight(scale: Float): PrivacyRect {
    val padding = height * max(0f, scale - 1f) / 2f
    return copy(
      top = (top - padding).coerceAtLeast(0f),
      bottom = (bottom + padding).coerceAtMost(1f),
    )
  }

  fun toGlRect() = GlPrivacyRect(left, 1f - bottom, right, 1f - top)
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

private data class PrivacyRects(val person: PrivacyRect?, val face: PrivacyRect?)

private class PoseTimeline(val keyframes: List<PoseKeyframe>) {
  val poseSamples: Int get() = keyframes.count { it.person != null }
  val faceSamples: Int get() = keyframes.count { it.face != null }

  /** Match exp-0012's 0.25 x median-area body outlier rejection. */
  fun filteredForBodyOutliers(): PoseTimeline {
    val areas = keyframes.mapNotNull { it.person?.let { box -> box.width * box.height } }.sorted()
    if (areas.isEmpty()) return this
    val medianArea = areas[areas.size / 2]
    return PoseTimeline(keyframes.map { frame ->
      val person = frame.person
      if (person == null || person.width * person.height < medianArea * 0.25f) {
        frame.copy(person = null, face = null)
      } else {
        frame
      }
    })
  }

  fun at(presentationTimeUs: Long): PrivacyRects? {
    val first = keyframes.firstOrNull() ?: return null
    if (presentationTimeUs <= first.presentationTimeUs) return PrivacyRects(first.person, first.face)
    val last = keyframes.last()
    if (presentationTimeUs >= last.presentationTimeUs) return PrivacyRects(last.person, last.face)

    var low = 0
    var high = keyframes.lastIndex
    while (low + 1 < high) {
      val middle = (low + high) / 2
      if (keyframes[middle].presentationTimeUs <= presentationTimeUs) low = middle else high = middle
    }
    val before = keyframes[low]
    val after = keyframes[high]
    val span = max(1L, after.presentationTimeUs - before.presentationTimeUs)
    val fraction = (presentationTimeUs - before.presentationTimeUs).toFloat() / span
    val person = if (before.person != null && after.person != null) {
      before.person.interpolate(after.person, fraction)
    } else {
      // Strict interpolation: never carry a stale box across a missed frame.
      null
    }
    val face = if (person != null && before.face != null && after.face != null) {
      before.face.interpolate(after.face, fraction)
    } else {
      null
    }
    return PrivacyRects(person, face)
  }
}

private class RTMPoseVideoScanner(
  private val context: Context,
  private val inputUri: String,
  private val onProgress: (Double) -> Unit,
  private val isCancelled: () -> Boolean,
) {
  data class Result(val timeline: PoseTimeline, val durationUs: Long)

  fun scan(): Result {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, Uri.parse(inputUri))
      val durationUs = (
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
          ?: 0L
      ) * 1_000L
      require(durationUs > 0) { "The recording duration could not be read." }
      val frameRate = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)
        ?.toDoubleOrNull()
        ?.takeIf { it.isFinite() && it >= 1.0 }
        ?: 30.0
      val metadataFrameCount = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)
          ?.toIntOrNull()?.takeIf { it > 0 }
      } else null
      val expectedFrames = metadataFrameCount ?: max(1, (durationUs * frameRate / 1_000_000).toInt())
      val keyframes = ArrayList<PoseKeyframe>(expectedFrames)

      RTMPoseEngine(context).use { engine ->
        for (frameIndex in 0 until expectedFrames) {
          if (isCancelled()) throw InterruptedException("Video privacy processing was cancelled.")
          val presentationTimeUs = (frameIndex * 1_000_000.0 / frameRate).toLong()
          val bitmap = decodeFrame(retriever, frameIndex, presentationTimeUs)
          if (bitmap != null) {
            try {
              val landmarks = engine.analyze(bitmap)
              val person = landmarks?.let(::personRect)
              keyframes += PoseKeyframe(
                presentationTimeUs = presentationTimeUs,
                person = person,
                face = if (landmarks == null || person == null) null else faceRect(
                  landmarks,
                  person,
                  bitmap.width.toFloat() / max(1, bitmap.height).toFloat(),
                ),
              )
            } finally {
              bitmap.recycle()
            }
          }
          onProgress(SCAN_PROGRESS_SHARE * (frameIndex + 1).toDouble() / expectedFrames)
        }
      }
      require(keyframes.isNotEmpty()) { "No video frames could be decoded for pose estimation." }
      return Result(
        timeline = PoseTimeline(keyframes.sortedBy { it.presentationTimeUs })
          .filteredForBodyOutliers(),
        durationUs = durationUs,
      )
    } finally {
      retriever.release()
    }
  }

  private fun decodeFrame(
    retriever: MediaMetadataRetriever,
    frameIndex: Int,
    presentationTimeUs: Long,
  ): Bitmap? = runCatching {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      retriever.getFrameAtIndex(frameIndex)
    } else {
      retriever.getFrameAtTime(presentationTimeUs, MediaMetadataRetriever.OPTION_CLOSEST)
    }
  }.getOrNull()

  private fun personRect(landmarks: List<RTMPosePoint>): PrivacyRect? {
    val points = landmarks.mapNotNull { normalizedPoint(it) }
    if (points.size < 6) return null
    val bounds = bounds(points)
    if (bounds.width < 0.10f || bounds.height < 0.15f || bounds.width * bounds.height < 0.02f) {
      return null
    }
    return PrivacyRect(
      left = (bounds.left - max(0.10f, bounds.width * 0.32f)).coerceIn(0f, 1f),
      top = (bounds.top - max(0.08f, bounds.height * 0.22f)).coerceIn(0f, 1f),
      right = (bounds.right + max(0.10f, bounds.width * 0.32f)).coerceIn(0f, 1f),
      bottom = (bounds.bottom + max(0.10f, bounds.height * 0.18f)).coerceIn(0f, 1f),
    )
  }

  private fun faceRect(
    landmarks: List<RTMPosePoint>,
    person: PrivacyRect,
    frameAspect: Float,
  ): PrivacyRect {
    val facePoints = landmarks.take(5).mapNotNull { normalizedPoint(it) }
    if (facePoints.size >= 3) {
      val bounds = bounds(facePoints)
      val width = max(0.025f, bounds.width)
      val height = max(0.035f, bounds.height)
      return PrivacyRect(
        left = (bounds.left - width * 0.40f).coerceIn(0f, 1f),
        top = (bounds.top - height * 0.85f).coerceIn(0f, 1f),
        right = (bounds.right + width * 0.40f).coerceIn(0f, 1f),
        bottom = (bounds.bottom + height * 0.60f).coerceIn(0f, 1f),
      ).scaledHeight(2f)
    }

    if (landmarks.size > 6) {
      val leftShoulder = normalizedPoint(landmarks[5], 0.10f)
      val rightShoulder = normalizedPoint(landmarks[6], 0.10f)
      if (leftShoulder != null && rightShoulder != null) {
        val shoulderWidth = max(0.04f, abs(rightShoulder.first - leftShoulder.first))
        val headWidth = min(0.45f, max(0.08f, shoulderWidth * 0.68f))
        val headHeight = min(0.42f, max(0.08f, headWidth * max(0.25f, frameAspect) * 1.35f))
        val centerX = (leftShoulder.first + rightShoulder.first) / 2f
        val shoulderY = (leftShoulder.second + rightShoulder.second) / 2f
        val bottom = min(1f, shoulderY + headHeight * 0.12f)
        return PrivacyRect(
          left = (centerX - headWidth * 0.60f).coerceIn(0f, 1f),
          top = (bottom - headHeight * 1.25f).coerceIn(0f, 1f),
          right = (centerX + headWidth * 0.60f).coerceIn(0f, 1f),
          bottom = bottom,
        ).scaledHeight(2f)
      }
    }

    val aspect = max(0.25f, frameAspect)
    val headHeight = min(person.height * 0.34f, max(0.08f, person.width * aspect * 0.55f))
    val headWidth = min(person.width * 0.65f, max(0.08f, headHeight / aspect))
    val centerX = (person.left + person.right) / 2f
    return PrivacyRect(
      left = (centerX - headWidth / 2f).coerceIn(0f, 1f),
      top = person.top,
      right = (centerX + headWidth / 2f).coerceIn(0f, 1f),
      bottom = min(person.bottom, person.top + headHeight),
    ).scaledHeight(2f)
  }

  private fun normalizedPoint(
    point: RTMPosePoint,
    confidence: Float = RTMPoseEngine.LANDMARK_THRESHOLD,
  ): Pair<Float, Float>? {
    if (point.confidence < confidence || !point.x.isFinite() || !point.y.isFinite()) return null
    if (point.x !in -0.1f..1.1f || point.y !in -0.1f..1.1f) return null
    return Pair(point.x.coerceIn(0f, 1f), point.y.coerceIn(0f, 1f))
  }

  private fun bounds(points: List<Pair<Float, Float>>) = PrivacyRect(
    left = points.minOf { it.first },
    top = points.minOf { it.second },
    right = points.maxOf { it.first },
    bottom = points.maxOf { it.second },
  )
}

private data class FrameResult(val face: GlPrivacyRect?, val person: GlPrivacyRect?)

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
  ): ListenableFuture<FrameResult> = try {
    val rects = timeline.at(presentationTimeUs)
      ?: throw IllegalStateException("No dense pose result was available for a video frame.")
    framesProcessed.incrementAndGet()
    if (blurFaces && rects.face != null) framesWithFaces.incrementAndGet()
    if (blurBackground) framesWithBackgroundBlur.incrementAndGet()
    if (lastProgressTimestampUs == Long.MIN_VALUE || presentationTimeUs - lastProgressTimestampUs >= 250_000) {
      lastProgressTimestampUs = presentationTimeUs
      val fraction = if (durationUs > 0) {
        min(0.99, max(0.0, presentationTimeUs.toDouble() / durationUs))
      } else 0.0
      onProgress(SCAN_PROGRESS_SHARE + fraction * (0.99 - SCAN_PROGRESS_SHARE))
    }
    Futures.immediateFuture(FrameResult(rects.face?.toGlRect(), rects.person?.toGlRect()))
  } catch (error: Throwable) {
    Futures.immediateFailedFuture(error)
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
      glProgram?.apply {
        use()
        setSamplerTexIdUniform("uTexSampler", scratchTexture.texId, 0)
        setIntUniform("uBlurFaces", if (blurFaces) 1 else 0)
        setIntUniform("uHasFace", if (result.face != null) 1 else 0)
        setIntUniform("uBlurBackground", if (blurBackground) 1 else 0)
        setIntUniform("uHasPerson", if (result.person != null) 1 else 0)
        val face = result.face
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
    "totalPoseSamples" to timeline.keyframes.size,
    "faceSamples" to timeline.faceSamples,
    "detectorMode" to "rtmdet_nano_rtmpose_t_coco17_dense",
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
      uniform int uHasFace;
      uniform int uBlurBackground;
      uniform int uHasPerson;
      uniform vec4 uFaceRect;
      uniform vec4 uPersonRect;
      varying vec2 vTexCoord;

      vec4 backgroundRedaction(vec2 uv) {
        vec2 block = max(vec2(30.0) / uResolution, 1.0 / uResolution);
        vec2 center = (floor(uv / block) + 0.5) * block;
        vec2 d = vec2(14.0) / uResolution;
        vec4 value = texture2D(uTexSampler, center) * 0.20;
        value += texture2D(uTexSampler, center + vec2(d.x, 0.0)) * 0.12;
        value += texture2D(uTexSampler, center - vec2(d.x, 0.0)) * 0.12;
        value += texture2D(uTexSampler, center + vec2(0.0, d.y)) * 0.12;
        value += texture2D(uTexSampler, center - vec2(0.0, d.y)) * 0.12;
        value += texture2D(uTexSampler, center + d) * 0.08;
        value += texture2D(uTexSampler, center - d) * 0.08;
        value += texture2D(uTexSampler, center + vec2(d.x, -d.y)) * 0.08;
        value += texture2D(uTexSampler, center + vec2(-d.x, d.y)) * 0.08;
        return value;
      }

      vec4 faceRedaction(vec2 uv) {
        vec2 d = vec2(20.0) / uResolution;
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
          color = mix(backgroundRedaction(vTexCoord), original, personMask);
        }
        if (uBlurFaces == 1 && uHasFace == 1) {
          float faceMask = rectMask(vTexCoord, uFaceRect, 0.0005);
          vec2 block = max((uFaceRect.zw - uFaceRect.xy) / 4.0, 1.0 / uResolution);
          vec2 sampleCoord = uFaceRect.xy +
            (floor((vTexCoord - uFaceRect.xy) / block) + 0.5) * block;
          color = mix(color, faceRedaction(sampleCoord), faceMask);
        } else if (uBlurFaces == 1 && uBlurBackground == 0) {
          color = backgroundRedaction(vTexCoord);
        }
        gl_FragColor = color;
      }
    """
  }
}

@UnstableApi
class FaceBlurModule : Module() {
  private class Operation(val outputFile: File, val promise: Promise) {
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
        blurFaces: Boolean,
        blurBackground: Boolean,
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
            val scan = RTMPoseVideoScanner(
              context = context,
              inputUri = inputUri,
              onProgress = { value -> sendProgress(operationId, value) },
              isCancelled = { operation.cancelled.get() },
            ).scan()
            if (operation.cancelled.get()) throw InterruptedException("cancelled")
            mainHandler.post {
              if (!operation.cancelled.get()) {
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
            }
          } catch (error: Throwable) {
            mainHandler.post {
              if (operation.cancelled.get()) rejectCancelled(operationId, operation)
              else reject(operationId, operation, error)
            }
          }
        }, "luche-rtmpose-dense-scan").start()
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

    AsyncFunction("diagnoseImageAsync") {
        inputUri: String,
        outputDirectoryUri: String,
        promise: Promise,
      ->
      val context = appContext.reactContext?.applicationContext
      val input = localFile(inputUri)
      val outputDirectory = localFile(outputDirectoryUri)
      if (context == null || input == null || outputDirectory == null) {
        promise.reject(
          "ERR_FACE_BLUR_DIAGNOSTIC",
          "Pose diagnostics require local input and output URLs.",
          null,
        )
        return@AsyncFunction
      }
      Thread({
        try {
          val bitmap = BitmapFactory.decodeFile(input.absolutePath)
            ?: throw IllegalArgumentException("The diagnostic image could not be decoded.")
          try {
            val points = RTMPoseEngine(context).use { engine ->
              engine.analyze(bitmap, outputDirectory)
            }
            promise.resolve(mapOf(
              "imageWidth" to bitmap.width,
              "imageHeight" to bitmap.height,
              "keypointCount" to (points?.size ?: 0),
              "outputDirectory" to outputDirectoryUri,
            ))
          } finally {
            bitmap.recycle()
          }
        } catch (error: Throwable) {
          promise.reject(
            "ERR_FACE_BLUR_DIAGNOSTIC",
            error.localizedMessage ?: "Pose diagnostics failed.",
            error,
          )
        }
      }, "luche-rtmpose-image-diagnostic").start()
    }
  }

  private fun startTransformer(
    context: Context,
    inputUri: String,
    outputUri: String,
    operationId: String,
    operation: Operation,
    scan: RTMPoseVideoScanner.Result,
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
