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
- The video is partitioned into fixed, non-overlapping 0.5-second windows. A
  window is unreliable only when its median count of joints at confidence 0.5
  is below five and its translation-corrected, torso-normalized residual-jump
  p90 exceeds 0.25. Unreliable windows pass through without any blur.
- The face region uses only COCO keypoints 0-4 at confidence 0.15 with the
  exp-0012 asymmetric padding and 2x height expansion, followed by a 20%
  upward-only extension. The bottom edge does not move. There are no shoulder
  or body-top fallbacks.
- Face redaction reduces the region to about four blocks across and then
  applies a strong Gaussian blur.
- Background redaction first removes fine detail with a coarse pixel grid,
  then adds Gaussian blur. The expanded person box is restored over this
  background with a feathered boundary.
- A reliable window with a usable body region receives background redaction.
  Its face is redacted only when at least three face keypoints pass the
  confidence threshold. If the window is unreliable or has no usable body
  region, the frame is left unchanged: no background blur and no face blur.

The native result reports decoded-frame, body, face, and total dense-sample
counts. No landmarks or video frames are persisted by the privacy module.
Checkpoint source, hashes, and license are recorded in `ios/Resources/MODELS.md`.
