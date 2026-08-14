package expo.modules.faceblur

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import java.io.File
import java.io.FileOutputStream
import java.nio.FloatBuffer
import java.security.MessageDigest
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

internal data class RTMPosePoint(
  val x: Float,
  val y: Float,
  val confidence: Float,
)

private data class DetectionBox(
  val left: Float,
  val top: Float,
  val right: Float,
  val bottom: Float,
) {
  val area: Float get() = max(0f, right - left) * max(0f, bottom - top)
}

/** Exact Android implementation of local-pose-debug exp-0012. */
internal class RTMPoseEngine(context: Context) : AutoCloseable {
  companion object {
    const val DETECTOR_THRESHOLD = 0.30f
    const val LANDMARK_THRESHOLD = 0.15f

    private const val DETECTOR_MODEL = "rtmdet_nano_person_320.onnx"
    private const val DETECTOR_SHA =
      "8297e829ccc5590c8e2d32d5a211f322a0585fb7467eec85eb12c9525b0b95d6"
    private const val POSE_MODEL = "rtmpose_t_coco17_256x192.onnx"
    private const val POSE_SHA =
      "a6c2f6a3896a4d51131d14d7a80a3d08b50f559af5a58a45d5b098aef510a70f"

    private const val DETECTOR_WIDTH = 320
    private const val DETECTOR_HEIGHT = 320
    private const val POSE_WIDTH = 192
    private const val POSE_HEIGHT = 256
    private const val KEYPOINT_COUNT = 17
  }

  private val environment = OrtEnvironment.getEnvironment()
  private val detector = createSession(
    materializeModel(context, DETECTOR_MODEL, DETECTOR_SHA),
  )
  private val pose = createSession(
    materializeModel(context, POSE_MODEL, POSE_SHA),
  )

  fun analyze(bitmap: Bitmap): List<RTMPosePoint>? {
    val pixels = IntArray(bitmap.width * bitmap.height)
    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    val box = detectLargestPerson(pixels, bitmap.width, bitmap.height) ?: return null
    return estimatePose(pixels, bitmap.width, bitmap.height, box)
  }

  private fun detectLargestPerson(
    pixels: IntArray,
    width: Int,
    height: Int,
  ): DetectionBox? {
    val ratio = min(DETECTOR_HEIGHT.toFloat() / height, DETECTOR_WIDTH.toFloat() / width)
    val resizedWidth = (width * ratio).toInt()
    val resizedHeight = (height * ratio).toInt()
    val plane = DETECTOR_WIDTH * DETECTOR_HEIGHT
    val input = FloatArray(3 * plane)
    val sample = FloatArray(3)
    val means = floatArrayOf(103.53f, 116.28f, 123.675f)
    val stds = floatArrayOf(57.375f, 57.12f, 58.395f)
    for (y in 0 until DETECTOR_HEIGHT) {
      for (x in 0 until DETECTOR_WIDTH) {
        if (x < resizedWidth && y < resizedHeight) {
          val sourceX = (x + 0.5f) / ratio - 0.5f
          val sourceY = (y + 0.5f) / ratio - 0.5f
          sampleRgb(pixels, width, height, sourceX, sourceY, 114, sample)
        } else {
          sample.fill(114f)
        }
        val index = y * DETECTOR_WIDTH + x
        input[index] = (sample[2] - means[0]) / stds[0]
        input[plane + index] = (sample[1] - means[1]) / stds[1]
        input[2 * plane + index] = (sample[0] - means[2]) / stds[2]
      }
    }

    OnnxTensor.createTensor(
      environment,
      FloatBuffer.wrap(input),
      longArrayOf(1, 3, DETECTOR_HEIGHT.toLong(), DETECTOR_WIDTH.toLong()),
    ).use { tensor ->
      detector.run(mapOf("input" to tensor), setOf("dets")).use { result ->
        @Suppress("UNCHECKED_CAST")
        val batches = result.get("dets").orElseThrow {
          IllegalStateException("RTMDet did not return its detection tensor.")
        }.value as Array<Array<FloatArray>>
        var largest: DetectionBox? = null
        for (detection in batches.firstOrNull().orEmpty()) {
          if (detection.size < 5 || detection[4] <= DETECTOR_THRESHOLD) continue
          val box = DetectionBox(
            left = (detection[0] / ratio).coerceIn(0f, (width - 1).toFloat()),
            top = (detection[1] / ratio).coerceIn(0f, (height - 1).toFloat()),
            right = (detection[2] / ratio).coerceIn(0f, (width - 1).toFloat()),
            bottom = (detection[3] / ratio).coerceIn(0f, (height - 1).toFloat()),
          )
          if (box.area > (largest?.area ?: 0f)) largest = box
        }
        return largest
      }
    }
  }

  private fun estimatePose(
    pixels: IntArray,
    width: Int,
    height: Int,
    box: DetectionBox,
  ): List<RTMPosePoint> {
    val centerX = (box.left + box.right) * 0.5f
    val centerY = (box.top + box.bottom) * 0.5f
    var scaleWidth = (box.right - box.left) * 1.25f
    var scaleHeight = (box.bottom - box.top) * 1.25f
    val aspect = POSE_WIDTH.toFloat() / POSE_HEIGHT
    if (scaleWidth > scaleHeight * aspect) {
      scaleHeight = scaleWidth / aspect
    } else {
      scaleWidth = scaleHeight * aspect
    }

    val plane = POSE_WIDTH * POSE_HEIGHT
    val input = FloatArray(3 * plane)
    val sample = FloatArray(3)
    val means = floatArrayOf(123.675f, 116.28f, 103.53f)
    val stds = floatArrayOf(58.395f, 57.12f, 57.375f)
    for (y in 0 until POSE_HEIGHT) {
      for (x in 0 until POSE_WIDTH) {
        val sourceX = centerX + (x - POSE_WIDTH * 0.5f) * scaleWidth / POSE_WIDTH
        val sourceY = centerY + (y - POSE_HEIGHT * 0.5f) * scaleHeight / POSE_HEIGHT
        sampleRgb(pixels, width, height, sourceX, sourceY, 0, sample)
        val index = y * POSE_WIDTH + x
        input[index] = (sample[2] - means[0]) / stds[0]
        input[plane + index] = (sample[1] - means[1]) / stds[1]
        input[2 * plane + index] = (sample[0] - means[2]) / stds[2]
      }
    }

    OnnxTensor.createTensor(
      environment,
      FloatBuffer.wrap(input),
      longArrayOf(1, 3, POSE_HEIGHT.toLong(), POSE_WIDTH.toLong()),
    ).use { tensor ->
      pose.run(mapOf("input" to tensor), setOf("simcc_x", "simcc_y")).use { result ->
        @Suppress("UNCHECKED_CAST")
        val simccX = result.get("simcc_x").orElseThrow {
          IllegalStateException("RTMPose did not return simcc_x.")
        }.value as Array<Array<FloatArray>>
        @Suppress("UNCHECKED_CAST")
        val simccY = result.get("simcc_y").orElseThrow {
          IllegalStateException("RTMPose did not return simcc_y.")
        }.value as Array<Array<FloatArray>>
        val xValues = simccX.firstOrNull()
          ?: throw IllegalStateException("RTMPose returned an empty simcc_x tensor.")
        val yValues = simccY.firstOrNull()
          ?: throw IllegalStateException("RTMPose returned an empty simcc_y tensor.")
        require(xValues.size == KEYPOINT_COUNT && yValues.size == KEYPOINT_COUNT) {
          "RTMPose returned an unexpected keypoint count."
        }
        return (0 until KEYPOINT_COUNT).map { keypoint ->
          val xMaximum = xValues[keypoint].indices.maxByOrNull { xValues[keypoint][it] } ?: 0
          val yMaximum = yValues[keypoint].indices.maxByOrNull { yValues[keypoint][it] } ?: 0
          val modelX = xMaximum / 2f
          val modelY = yMaximum / 2f
          RTMPosePoint(
            x = (modelX / POSE_WIDTH * scaleWidth + centerX - scaleWidth / 2f) /
              max(1, width).toFloat(),
            y = (modelY / POSE_HEIGHT * scaleHeight + centerY - scaleHeight / 2f) /
              max(1, height).toFloat(),
            confidence = (xValues[keypoint][xMaximum] + yValues[keypoint][yMaximum]) * 0.5f,
          )
        }
      }
    }
  }

  override fun close() {
    detector.close()
    pose.close()
  }

  private fun createSession(model: File): OrtSession = OrtSession.SessionOptions().use { options ->
    environment.createSession(model.absolutePath, options)
  }

  private fun sampleRgb(
    pixels: IntArray,
    width: Int,
    height: Int,
    x: Float,
    y: Float,
    border: Int,
    output: FloatArray,
  ) {
    val x0 = floor(x).toInt()
    val y0 = floor(y).toInt()
    val tx = x - x0
    val ty = y - y0

    fun channel(px: Int, py: Int, shift: Int): Float {
      if (px !in 0 until width || py !in 0 until height) return border.toFloat()
      return ((pixels[py * width + px] shr shift) and 0xff).toFloat()
    }

    // Android pixels are ARGB; write RGB into output.
    val shifts = intArrayOf(16, 8, 0)
    for (index in shifts.indices) {
      val shift = shifts[index]
      val top = channel(x0, y0, shift) * (1f - tx) + channel(x0 + 1, y0, shift) * tx
      val bottom = channel(x0, y0 + 1, shift) * (1f - tx) +
        channel(x0 + 1, y0 + 1, shift) * tx
      output[index] = top * (1f - ty) + bottom * ty
    }
  }

  private fun materializeModel(context: Context, assetName: String, expectedSha: String): File {
    val directory = File(context.noBackupFilesDir, "pose-models").apply { mkdirs() }
    val target = File(directory, assetName)
    if (!target.isFile || sha256(target) != expectedSha) {
      val temporary = File(directory, "$assetName.tmp")
      context.assets.open(assetName).use { input ->
        FileOutputStream(temporary).use { output -> input.copyTo(output) }
      }
      check(sha256(temporary) == expectedSha) { "Bundled pose model failed its integrity check: $assetName" }
      if (target.exists()) target.delete()
      check(temporary.renameTo(target)) { "Could not install bundled pose model: $assetName" }
    }
    return target
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(1024 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
