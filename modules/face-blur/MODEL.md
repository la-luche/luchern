# On-device privacy-region model

Luche ships the exact pose stack evaluated as local experiment `exp-0012`:

- RTMDet-nano person detector (0.99M parameters), 320 x 320 ONNX input,
  confidence threshold 0.30.
- RTMPose-t Body7 COCO-17 (3.34M parameters), 192 x 256 ONNX input,
  keypoint threshold 0.15.
- 4.33M model parameters total. Both checkpoints are bundled in the app and
  executed with ONNX Runtime. There is no SDK key, model download, license
  request, analytics event, or network inference.

Runtime contract:

- Pose is estimated independently for every decoded video frame (dense stride
  1). The largest detected person is used. A missed detection is never filled
  with a stale box.
- The body region requires six visible COCO-17 keypoints and the exact
  exp-0012 size checks and padding. Boxes below 25% of the clip's median body
  area are rejected as transient outliers.
- The face region uses COCO keypoints 0-4 with the exp-0012 asymmetric padding
  and 2x height expansion. It falls back to shoulders 5-6, then to the top of
  the body region for clipped or turned-away heads.
- Face redaction reduces the region to about four blocks across and then
  applies a strong Gaussian blur.
- Background redaction first removes fine detail with a coarse pixel grid,
  then adds Gaussian blur. The expanded person box is restored over this
  background with a feathered boundary.
- Missing/rejected body detections redact the complete frame. Face-only mode
  also redacts the complete frame when no face fallback can be formed.
- If no person is detected anywhere in the clip, preprocessing fails closed;
  the app does not upload the sanitized path until the user retries or
  explicitly elects to send the original.

The native result reports decoded-frame, body, face, and total dense-sample
counts. No landmarks or video frames are persisted by the privacy module.
Checkpoint source, hashes, and license are recorded in `ios/Resources/MODELS.md`.
