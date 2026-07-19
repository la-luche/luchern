package expo.modules.faceblur

import android.content.Context
import android.net.Uri
import android.opengl.GLES20
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
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Arrays
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import org.tensorflow.lite.Interpreter

private const val PROGRESS_EVENT = "onFaceBlurProgress"
private const val MODEL_NAME = "luche_blaze_face_full_range.tflite"
private const val DETECTOR_SIZE = 192
private const val ANCHOR_GRID_SIZE = 48
private const val BOX_COUNT = ANCHOR_GRID_SIZE * ANCHOR_GRID_SIZE
private const val BOX_VALUES = 16
private const val MAXIMUM_FACES = 8
private const val MINIMUM_SCORE = 0.45f
private const val NMS_IOU_THRESHOLD = 0.3f

private data class FaceRect(
  val left: Float,
  val bottom: Float,
  val right: Float,
  val top: Float,
)

private data class FrameResult(val faces: List<FaceRect>)

private data class DetectionBox(
  val left: Float,
  val top: Float,
  val right: Float,
  val bottom: Float,
  val score: Float,
)

/** Direct BlazeFace TFLite runner. No MediaPipe Tasks telemetry is linked. */
private class BlazeFaceDetector(context: Context) : AutoCloseable {
  private val model: ByteBuffer
  private val interpreter: Interpreter
  private val input = ByteBuffer.allocateDirect(DETECTOR_SIZE * DETECTOR_SIZE * 3 * 4)
    .order(ByteOrder.nativeOrder())
  private val pixels = IntArray(DETECTOR_SIZE * DETECTOR_SIZE)
  private val sourcePixels = IntArray(DETECTOR_SIZE * DETECTOR_SIZE)
  private val boxes = Array(1) { Array(BOX_COUNT) { FloatArray(BOX_VALUES) } }
  private val scores = Array(1) { Array(BOX_COUNT) { FloatArray(1) } }
  private val boxesOutputIndex: Int
  private val scoresOutputIndex: Int

  init {
    val modelBytes = context.assets.open(MODEL_NAME).use { it.readBytes() }
    model = ByteBuffer.allocateDirect(modelBytes.size).order(ByteOrder.nativeOrder())
    model.put(modelBytes)
    model.rewind()
    interpreter = Interpreter(
      model,
      Interpreter.Options().setNumThreads(2).setUseXNNPACK(true),
    )
    boxesOutputIndex = (0 until interpreter.outputTensorCount).first { index ->
      interpreter.getOutputTensor(index).shape().lastOrNull() == BOX_VALUES
    }
    scoresOutputIndex = (0 until interpreter.outputTensorCount).first { index ->
      interpreter.getOutputTensor(index).shape().lastOrNull() == 1
    }
  }

  fun detect(bitmap: android.graphics.Bitmap): List<FaceRect> {
    require(bitmap.width in 1..DETECTOR_SIZE && bitmap.height in 1..DETECTOR_SIZE) {
      "BlazeFace input must fit within ${DETECTOR_SIZE}x$DETECTOR_SIZE."
    }
    // Match MediaPipe's official preprocessing: preserve aspect ratio and
    // center the resized frame over a zero-valued (black) square.
    Arrays.fill(pixels, 0xff000000.toInt())
    bitmap.getPixels(sourcePixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    val padX = (DETECTOR_SIZE - bitmap.width) / 2
    val padY = (DETECTOR_SIZE - bitmap.height) / 2
    for (row in 0 until bitmap.height) {
      sourcePixels.copyInto(
        pixels,
        destinationOffset = (row + padY) * DETECTOR_SIZE + padX,
        startIndex = row * bitmap.width,
        endIndex = (row + 1) * bitmap.width,
      )
    }
    input.rewind()
    for (pixel in pixels) {
      input.putFloat(((pixel shr 16 and 0xff) / 127.5f) - 1f)
      input.putFloat(((pixel shr 8 and 0xff) / 127.5f) - 1f)
      input.putFloat(((pixel and 0xff) / 127.5f) - 1f)
    }
    input.rewind()
    interpreter.runForMultipleInputsOutputs(
      arrayOf(input),
      mutableMapOf<Int, Any>(
        boxesOutputIndex to boxes,
        scoresOutputIndex to scores,
      ),
    )

    val candidates = ArrayList<DetectionBox>()
    for (index in 0 until BOX_COUNT) {
      val logit = scores[0][index][0].coerceIn(-100f, 100f)
      val score = 1f / (1f + exp(-logit))
      if (score < MINIMUM_SCORE) continue

      val raw = boxes[0][index]
      val anchorX = ((index % ANCHOR_GRID_SIZE) + 0.5f) / ANCHOR_GRID_SIZE
      val anchorY = ((index / ANCHOR_GRID_SIZE) + 0.5f) / ANCHOR_GRID_SIZE
      // MediaPipe's BlazeFace export uses reverse_output_order: y, x, h, w.
      val centerX = raw[1] / DETECTOR_SIZE + anchorX
      val centerY = raw[0] / DETECTOR_SIZE + anchorY
      val width = raw[3] / DETECTOR_SIZE
      val height = raw[2] / DETECTOR_SIZE
      candidates += DetectionBox(
        left = centerX - width / 2,
        top = centerY - height / 2,
        right = centerX + width / 2,
        bottom = centerY + height / 2,
        score = score,
      )
    }

    val remaining = candidates.sortedByDescending { it.score }.toMutableList()
    val selected = ArrayList<DetectionBox>()
    while (remaining.isNotEmpty() && selected.size < MAXIMUM_FACES) {
      val seed = remaining.removeAt(0)
      val overlapping = arrayListOf(seed)
      val iterator = remaining.iterator()
      while (iterator.hasNext()) {
        val candidate = iterator.next()
        if (intersectionOverUnion(seed, candidate) > NMS_IOU_THRESHOLD) {
          overlapping += candidate
          iterator.remove()
        }
      }
      val scoreSum = overlapping.sumOf { it.score.toDouble() }.toFloat()
      selected += DetectionBox(
        left = overlapping.sumOf { (it.left * it.score).toDouble() }.toFloat() / scoreSum,
        top = overlapping.sumOf { (it.top * it.score).toDouble() }.toFloat() / scoreSum,
        right = overlapping.sumOf { (it.right * it.score).toDouble() }.toFloat() / scoreSum,
        bottom = overlapping.sumOf { (it.bottom * it.score).toDouble() }.toFloat() / scoreSum,
        score = seed.score,
      )
    }
    return selected.map { box ->
      val projected = DetectionBox(
        left = (box.left * DETECTOR_SIZE - padX) / bitmap.width,
        top = (box.top * DETECTOR_SIZE - padY) / bitmap.height,
        right = (box.right * DETECTOR_SIZE - padX) / bitmap.width,
        bottom = (box.bottom * DETECTOR_SIZE - padY) / bitmap.height,
        score = box.score,
      )
      expandedRect(projected)
    }
  }

  override fun close() {
    interpreter.close()
  }

  private fun expandedRect(box: DetectionBox): FaceRect {
    val width = box.right - box.left
    val height = box.bottom - box.top
    val horizontalPadding = width * 0.35f
    val topPadding = height * 0.45f
    val bottomPadding = height * 0.25f
    val left = (box.left - horizontalPadding).coerceIn(0f, 1f)
    val right = (box.right + horizontalPadding).coerceIn(0f, 1f)
    val topFromTop = (box.top - topPadding).coerceIn(0f, 1f)
    val bottomFromTop = (box.bottom + bottomPadding).coerceIn(0f, 1f)
    return FaceRect(
      left = left,
      bottom = 1f - bottomFromTop,
      right = right,
      top = 1f - topFromTop,
    )
  }

  private fun intersectionOverUnion(a: DetectionBox, b: DetectionBox): Float {
    val intersectionWidth = max(0f, min(a.right, b.right) - max(a.left, b.left))
    val intersectionHeight = max(0f, min(a.bottom, b.bottom) - max(a.top, b.top))
    val intersection = intersectionWidth * intersectionHeight
    val areaA = max(0f, a.right - a.left) * max(0f, a.bottom - a.top)
    val areaB = max(0f, b.right - b.left) * max(0f, b.bottom - b.top)
    val union = areaA + areaB - intersection
    return if (union > 0f) intersection / union else 0f
  }
}

@UnstableApi
private class FaceMosaicProcessor(
  context: Context,
  private val durationUs: Long,
  private val onProgress: (Double) -> Unit,
) : ByteBufferGlEffect.Processor<FrameResult> {
  private val detector = BlazeFaceDetector(context)
  private val framesProcessed = AtomicInteger(0)
  private val framesWithFaces = AtomicInteger(0)
  private val detections = AtomicInteger(0)

  private var inputWidth = 0
  private var inputHeight = 0
  private var detectorWidth = DETECTOR_SIZE
  private var detectorHeight = DETECTOR_SIZE
  private var scratchTexture = GlTextureInfo.UNSET
  private var glProgram: GlProgram? = null
  private var lastProgressTimestampUs = Long.MIN_VALUE

  override fun configure(inputWidth: Int, inputHeight: Int): Size {
    this.inputWidth = inputWidth
    this.inputHeight = inputHeight
    if (scratchTexture != GlTextureInfo.UNSET) {
      scratchTexture.release()
    }
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
    val scale = min(
      DETECTOR_SIZE.toFloat() / inputWidth,
      DETECTOR_SIZE.toFloat() / inputHeight,
    )
    detectorWidth = (inputWidth * scale).roundToInt().coerceIn(1, DETECTOR_SIZE)
    detectorHeight = (inputHeight * scale).roundToInt().coerceIn(1, DETECTOR_SIZE)
    return Size(detectorWidth, detectorHeight)
  }

  override fun getScaledRegion(presentationTimeUs: Long): GlRect =
    GlRect(inputWidth, inputHeight)

  @Synchronized
  override fun processImage(
    image: ByteBufferGlEffect.Image,
    presentationTimeUs: Long,
  ): ListenableFuture<FrameResult> {
    return try {
      val bitmap = image.copyToBitmap()
      val faces = try {
        detector.detect(bitmap)
      } finally {
        bitmap.recycle()
      }

      framesProcessed.incrementAndGet()
      if (faces.isNotEmpty()) framesWithFaces.incrementAndGet()
      detections.addAndGet(faces.size)
      if (
        lastProgressTimestampUs == Long.MIN_VALUE ||
        presentationTimeUs - lastProgressTimestampUs >= 250_000
      ) {
        lastProgressTimestampUs = presentationTimeUs
        val progress = if (durationUs > 0) {
          min(0.99, max(0.0, presentationTimeUs.toDouble() / durationUs.toDouble()))
        } else {
          0.0
        }
        onProgress(progress)
      }
      Futures.immediateFuture(FrameResult(faces))
    } catch (error: Throwable) {
      Futures.immediateFailedFuture(error)
    }
  }

  override fun finishProcessingAndBlend(
    outputFrame: GlTextureInfo,
    presentationTimeUs: Long,
    result: FrameResult,
  ) {
    if (result.faces.isEmpty()) return
    try {
      val fullFrame = GlRect(outputFrame.width, outputFrame.height)
      GlUtil.blitFrameBuffer(
        outputFrame.fboId,
        fullFrame,
        scratchTexture.fboId,
        fullFrame,
      )
      GlUtil.focusFramebufferUsingCurrentContext(
        outputFrame.fboId,
        outputFrame.width,
        outputFrame.height,
      )

      val rects = FloatArray(MAXIMUM_FACES * 4)
      result.faces.forEachIndexed { index, face ->
        val offset = index * 4
        rects[offset] = face.left
        rects[offset + 1] = face.bottom
        rects[offset + 2] = face.right
        rects[offset + 3] = face.top
      }
      glProgram?.apply {
        use()
        setSamplerTexIdUniform("uTexSampler", scratchTexture.texId, 0)
        setIntUniform("uFaceCount", result.faces.size)
        setFloatsUniform("uFaceRects[0]", rects)
        bindAttributesAndUniforms()
      }
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
      GlUtil.checkGlError()
    } catch (error: GlUtil.GlException) {
      throw VideoFrameProcessingException(error, presentationTimeUs)
    }
  }

  override fun release() {
    detector.close()
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
    "detections" to detections.get(),
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
      uniform int uFaceCount;
      uniform vec4 uFaceRects[8];
      varying vec2 vTexCoord;

      void main() {
        vec2 sampleCoord = vTexCoord;
        for (int i = 0; i < 8; i++) {
          if (i < uFaceCount) {
            vec4 face = uFaceRects[i];
            if (
              vTexCoord.x >= face.x && vTexCoord.x <= face.z &&
              vTexCoord.y >= face.y && vTexCoord.y <= face.w
            ) {
              vec2 block = max((face.zw - face.xy) / 6.0, 1.0 / uResolution);
              sampleCoord = face.xy +
                (floor((vTexCoord - face.xy) / block) + 0.5) * block;
            }
          }
        }
        gl_FragColor = texture2D(uTexSampler, sampleCoord);
      }
    """
  }
}

@UnstableApi
class FaceBlurModule : Module() {
  private data class Operation(
    val transformer: Transformer,
    val outputFile: File,
    val promise: Promise,
  )

  private val mainHandler = Handler(Looper.getMainLooper())
  private val operations = mutableMapOf<String, Operation>()

  override fun definition() = ModuleDefinition {
    Name("FaceBlur")
    Events(PROGRESS_EVENT)

    AsyncFunction("blurVideoAsync") {
        inputUri: String,
        outputUri: String,
        operationId: String,
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
        promise.reject("ERR_FACE_BLUR", "Face blurring requires local file URLs.", null)
        return@AsyncFunction
      }

      try {
        val durationUs = videoDurationUs(context, inputUri)
        val processor = FaceMosaicProcessor(context, durationUs) { progress ->
          mainHandler.post {
            sendEvent(PROGRESS_EVENT, mapOf(
              "operationId" to operationId,
              "progress" to progress,
            ))
          }
        }
        mainHandler.post {
          try {
            if (operations.containsKey(operationId)) {
              processor.release()
              promise.reject("ERR_FACE_BLUR_BUSY", "This recording is already being processed.", null)
              return@post
            }
            output.parentFile?.mkdirs()
            output.delete()
            val effect = ByteBufferGlEffect(processor)
            val editedMediaItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(inputUri)))
              .setRemoveAudio(true)
              .setEffects(Effects(emptyList(), listOf(effect)))
              .build()

            lateinit var transformer: Transformer
            transformer = Transformer.Builder(context)
              .setUsePlatformDiagnostics(false)
              .setVideoMimeType(MimeTypes.VIDEO_H264)
              .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                  if (operations.remove(operationId) == null) {
                    output.delete()
                    return
                  }
                  sendEvent(PROGRESS_EVENT, mapOf(
                    "operationId" to operationId,
                    "progress" to 1.0,
                  ))
                  promise.resolve(processor.result(outputUri))
                }

                override fun onError(
                  composition: Composition,
                  exportResult: ExportResult,
                  exportException: ExportException,
                ) {
                  if (operations.remove(operationId) == null) return
                  output.delete()
                  promise.reject(
                    "ERR_FACE_BLUR",
                    exportException.localizedMessage ?: "Face blurring failed.",
                    exportException,
                  )
                }
              })
              .build()
            operations[operationId] = Operation(transformer, output, promise)
            sendEvent(PROGRESS_EVENT, mapOf(
              "operationId" to operationId,
              "progress" to 0.0,
            ))
            transformer.start(editedMediaItem, output.absolutePath)
          } catch (error: Throwable) {
            operations.remove(operationId)
            output.delete()
            runCatching { processor.release() }
            promise.reject(
              "ERR_FACE_BLUR",
              error.localizedMessage ?: "Face blurring could not start.",
              error,
            )
          }
        }
      } catch (error: Throwable) {
        promise.reject(
          "ERR_FACE_BLUR",
          error.localizedMessage ?: "Face blurring could not start.",
          error,
        )
      }
    }

    AsyncFunction("cancelAsync") { operationId: String ->
      mainHandler.post {
        val operation = operations.remove(operationId) ?: return@post
        operation.transformer.cancel()
        operation.outputFile.delete()
        operation.promise.reject("ERR_FACE_BLUR_CANCELLED", "Face blurring was cancelled.", null)
      }
    }
  }

  private fun localFile(uriString: String): File? {
    val uri = Uri.parse(uriString)
    if (uri.scheme != "file" || uri.path.isNullOrBlank()) return null
    return File(requireNotNull(uri.path))
  }

  private fun videoDurationUs(context: Context, inputUri: String): Long {
    val retriever = android.media.MediaMetadataRetriever()
    return try {
      retriever.setDataSource(context, Uri.parse(inputUri))
      val millis = retriever
        .extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)
        ?.toLongOrNull() ?: 0L
      millis * 1_000L
    } finally {
      retriever.release()
    }
  }
}
