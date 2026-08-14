# Production pose models

The privacy renderer bundles the exact ONNX checkpoints evaluated as
`exp-0012` in the local pose-debug service.

- Detector: RTMDet-nano person, 320 x 320, detector threshold 0.30
  - Source: `rtmdet_nano_8xb32-100e_coco-obj365-person-05d8511e`
  - File: `rtmdet_nano_person_320.onnx`
  - SHA-256: `8297e829ccc5590c8e2d32d5a211f322a0585fb7467eec85eb12c9525b0b95d6`
- Pose: RTMPose-t Body7 COCO-17, 192 x 256, landmark threshold 0.15
  - Source: `rtmpose-t_simcc-body7_pt-body7_420e-256x192-026a1439`
  - File: `rtmpose_t_coco17_256x192.onnx`
  - SHA-256: `a6c2f6a3896a4d51131d14d7a80a3d08b50f559af5a58a45d5b098aef510a70f`

Both models are from OpenMMLab's MMPose/RTMPose release and are distributed
under Apache License 2.0. The upstream project and license are available at:
https://github.com/open-mmlab/mmpose
