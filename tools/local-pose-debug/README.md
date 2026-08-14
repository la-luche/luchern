# Luche local pose debug service

This Mac-local service runs BlazePose Lite or Heavy checkpoints through the
same MediaPipe graph used by the React Native app's privacy module, or an
RTMDet + RTMPose ONNX checkpoint pair through ONNX Runtime. It caches raw
landmarks and creates a new immutable experiment folder for every model and
set of face/body box settings. The RTMPose backend is a Mac experiment path;
it does not alter the React Native app.

## Start

Double-click `start.command`, or run:

```bash
./start.command
```

The first launch creates an isolated `.venv` from the fully pinned
`requirements.lock.txt`; later launches are quick no-op checks.

The browser opens at `http://127.0.0.1:8766`. The default experiment root is:

```text
/Users/ksc/feral_analysis/luchern/test_local_pose_estimatino
```

Override it without changing source:

```bash
LUCHE_POSE_EXPERIMENT_ROOT=/path/to/samples ./start.command
```

## Input layout

Put videos directly in the experiment root or any subfolder. Put each model
pair in a named checkpoint folder:

```text
test_local_pose_estimatino/
  IMG_0453.MOV
  checkpoints/
    quickpose-lite-exact/
      pose_detection.tflite
      pose_landmark_lite.tflite
    quickpose-heavy-exact/
      pose_detection.tflite
      pose_landmark_lite.tflite  # official Heavy model installed under the graph's expected filename
    rtmpose-tiny-rtmdet-nano/
      checkpoint.json
      detector/end2end.onnx
      pose/end2end.onnx
```

The browser rescans this layout whenever it loads. Model inference is cached by
the full source-video hash, both checkpoint hashes, and inference settings.
Changing only face/body box geometry reuses the cached landmarks.

Overlays default to the body/face rectangles plus all 33 raw BlazePose points,
skeleton edges, landmark index, visibility/presence, and the exact sampled
frame/time delta. Unset optional proto confidence fields are shown as `--`.
Points and their labels use a confidence heatmap: red at 0, yellow at 0.5, and
green at 1. The effective value is `min(visibility, presence)` when presence is
set; an unset presence field is ignored rather than treated as zero.
These layers can be toggled independently under the browser's advanced
settings.

## Experiment outputs

Every click of **Run experiment** allocates a fresh folder. Nothing is
overwritten:

```text
outputs/exp-0001--wider-face-tight-body/
  manifest.json
  landmarks/
  overlays/
  reports/
```

The manifest records the exact settings, source hash, checkpoint hashes, cache
status, timings, and output paths. Use a short descriptive experiment name; if
left blank, the service creates a name from the face/body padding and sample
stride.

This is an internal patient-video debugging tool. It binds only to
`127.0.0.1`; do not change the bind address or expose the output directory.

## Add a production trial (Peter's Mac only)

The helper resolves the trial in Neon through the Pi, obtains a short-lived R2
URL, validates the downloaded video, and never prints or persists the URL:

```bash
python3 scripts/download_luche_trial.py 211 \
  arising-from-chair--trial-211.mp4 \
  --expected-display-name "Arising from Chair"
```

The Pi path is intentionally operator-gated (`whoami == ksc`). Source videos
and generated experiments remain ignored by git.

## Normalize the test library to app capture size

The current app's observed production contract is 720×1280 **display**
resolution (normally coded as 1280×720 plus a −90° transform), about 29.97 fps,
and about 3 Mbps. Normalize only videos whose effective display dimensions do
not match:

```bash
python3 scripts/normalize_test_library.py
```

Matching app-native videos are left byte-for-byte unchanged. Mismatches are
autorotated, scaled/padded to 720×1280, encoded as muted `hvc1` HEVC at 3 Mbps,
validated with `ffprobe`, and atomically replaced.
