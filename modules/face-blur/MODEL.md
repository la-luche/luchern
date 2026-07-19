# Face detector model

Both native implementations bundle the same MediaPipe BlazeFace full-range
float16 model:

- Source: `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/latest/blaze_face_full_range.tflite`
- Downloaded: 2026-07-19
- Size: 1,083,786 bytes
- SHA-256: `3698b18f063835bc609069ef052228fbe86d9c9a6dc8dcb7c7c2d69aed2b181b`
- License: Apache 2.0 (MediaPipe model distribution)

The full-range model is intentional: Luche normally records a full body from
the rear camera, where a face is much smaller than in a selfie. Its native
192×192 detector input is used on both platforms. The app calls TensorFlow Lite
directly and implements the same SSD decode/NMS locally; it does not link the
prebuilt MediaPipe Tasks wrappers because those wrappers contain mandatory
Google usage telemetry.

Runtime contract (tensor metadata confirmed from the FlatBuffer; decode matches
the full-range BlazeFace graph configuration):

- input: float32 RGB `[1, 192, 192, 3]`, normalized with `(channel / 127.5) - 1`
- resize: preserve aspect ratio, centered zero-value letterbox, then project boxes back
- boxes: float32 `[1, 2304, 16]`
- scores: float32 `[1, 2304, 1]`
- anchors: fixed 48×48 grid, 0.5 cell offset
- box order: `y, x, h, w` (`reverse_output_order`)
- postprocess: sigmoid at 0.45, weighted NMS at IoU 0.3, maximum eight faces
