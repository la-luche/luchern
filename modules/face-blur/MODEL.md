# QuickPose privacy-region model

Luche uses `@quickpose/react-native` 0.6.0 and the native QuickPose SDKs it
wraps. The React Native view only supports a live camera, so Luche calls the
same native SDKs from its local Expo video module to process an already-approved
recording without replacing the existing `expo-camera` capture flow.
The Expo config plugin pins the iOS SDK Git pods to QuickPose v1.4.0; Android
uses `quickpose-mp` 0.6 and `quickpose-core` 0.22 from Maven.

Runtime contract:

- QuickPose samples the recorded video every 200 ms (about five poses/second).
- Successful pose boxes are linearly interpolated by presentation timestamp
  during the export pass. A missing sparse sample is never extrapolated as a
  stale box across a longer gap.
- The face box uses only visible head landmarks. Its asymmetric padding covers
  forehead through chin, then expands every edge by a further 20% of the
  measured head width/height based on production-video review. Nearby hands,
  shoulders, and movement remain outside the redacted region.
- Face mode requires a plausible face in at least 40% of sparse samples; a few
  isolated pose hallucinations are rejected instead of producing a bogus blur.
- The person box uses all visible body landmarks plus generous horizontal,
  top, and bottom padding. Background blur is applied outside that box with a
  feathered boundary.
- Background processing requires reliable pose coverage and plausible
  full-person geometry across at least 60% of sparse samples. This rejects the
  known single-person BlazePose failure where a close hand is merged with a
  different, smaller person in the background; the app asks the user to turn
  background blur off instead of exporting a wrong-subject or fully blurred
  clinical video.
- If QuickPose finds no person in the clip, preprocessing fails closed and the
  video is not uploaded until the user retries or explicitly sends the
  original.

QuickPose inference runs on-device and no video frame or landmark coordinate is
sent to QuickPose. The SDK does validate its license over the network. Its
Android 0.22 client sends the package ID, SDK key, platform/version, and Android
device ID to `https://api.quickpose.ai/sdk/v1/validate-key`; the user-facing
privacy copy discloses app/device identifier validation. Release builds must set
`EXPO_PUBLIC_QUICKPOSE_SDK_KEY` to a QuickPose key registered for
`ai.getferal.luche` (iOS and Android registrations as required by QuickPose).

The cloud QC runner accepts arbitrary compatible detector/landmark model paths
and verifies their SHA-256 hashes before inference. QuickPose's mobile API only
exposes the built-in `.light`, `.full`, and `.heavy` choices; substituting an
arbitrary mobile checkpoint therefore requires replacing the small native pose
adapter with direct MediaPipe/TFLite inference (the box/interpolation/export
layers do not need to change).
