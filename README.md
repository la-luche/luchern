# Luche RN

React Native + Expo rebuild of the Luche motor-test app (the Swift original lives
in `../v2/Luche/`). This version does **all inference in the cloud** — per-test
recordings are just video captures that get sent to a server for analysis. No
Core ML, no on-device model, no frame buffering.

> Status: **Experimental cloud pipeline (2026-07-13).** `src/lib/cloud.ts` talks to
> `feral-api`: presigned R2 upload → Sapiens2 keypoints (serve_luche/RunPod) →
> hand-written kinematic heuristic. These scores are uncalibrated estimates, not
> trained/validated keypoints→UPDRS models. Auth uses the current Clerk account
> exclusively so ownership stays stable across devices. Finger keypoints are
> the most usable signal;
> none of the patient-facing grades should be treated as clinically validated.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Expo SDK 54 (RN 0.81, React 19.1), TypeScript |
| Navigation | expo-router (file-based, `src/app/`) |
| Styling | NativeWind (Tailwind) — **Tailwind pinned to v3**, see below |
| Camera | `expo-camera` (`CameraView`, video mode) |
| Video playback | `expo-video` |
| Persistence | `@react-native-async-storage/async-storage` |
| Icons | `@expo/vector-icons` (MaterialCommunityIcons / Ionicons) |

## Run it

```bash
npm install
npx expo start        # then press i (iOS) / a (Android)
```

Camera recording requires a **real device or a config-dev-client build** — the
simulator has no camera feed. Capture works on device via Expo Go.

Useful checks:

```bash
npx tsc --noEmit                    # typecheck
npx expo export --platform ios      # bundle smoke test (no device needed)
```

## Architecture

### Screen flow (mirrors the Swift app, minus local inference)

```
Menu ──select test──▶ Instructions ──Continue──▶ Recording ──Start/End──▶ Result detail
 (/)                   (/test/[id])              (/record/[id])            (/results/[id])
  │                                                                              ▲
  └───────────────────── Previous recordings (/results) ─────────────────────────┘
```

A first-launch **medical disclaimer** gate (`DisclaimerGate`) wraps everything;
an **About** screen (`/about`) is reachable from the menu.

### Directory map

```
src/
  app/                     # expo-router screens (one file = one route)
    _layout.tsx            # Stack + DisclaimerGate + global.css import
    index.tsx              # Menu
    test/[id].tsx          # Instructions
    record/[id].tsx        # Camera + Start/End
    results/index.tsx      # Recording cards list
    results/[id].tsx       # Playback + cloud-analysis panel
    about.tsx              # Sharing, support, and release details
  components/              # hand-built, ~8 small pieces (no UI kit)
  lib/
    tests.ts               # the 3 movement tests currently exposed
    types.ts               # Recording / CloudResult / status
    cloud.ts               # <- THE PLACEHOLDER SEAM (replace for real API)
    storage.ts             # AsyncStorage store + lifecycle driver + hooks
    theme.ts               # raw color values for icon/overlay props
```

### The cloud seam (`src/lib/cloud.ts`)

The only module that knows about the cloud. It separates the expensive byte
upload from the small idempotent trial-creation call:

```ts
uploadRecording(uri, testId)       -> Promise<{ uploadId }>
createAnalysisTrial(uploadId, ...) -> Promise<{ jobId }>
pollResult(jobId, testId)          -> Promise<CloudResult>
```

`storage.ts` optionally drives `preparing -> uploading -> processing -> done`, persists the upload ID
immediately after the video reaches R2, and persists the job ID before polling.
This makes relaunch/retry avoid retransmitting a completed upload. It also
hydrates metadata from `GET /me/trials`, keeps uploaded videos locally for
three days, and requests a signed cloud URL when an older video is opened.

When **Blur faces before upload** is enabled in About (off by default), a local
Expo module runs the same bundled full-range BlazeFace model directly through
TensorFlow Lite/LiteRT on iOS and Android (without MediaPipe Tasks telemetry),
redacts every decoded frame, and writes a new MP4 before `uploadRecording` can
run. The sanitized URI is persisted before the original is permanently deleted.
If preprocessing fails, upload remains blocked until the user retries or
explicitly confirms **Send without face blurring**.

### Data model

One `Recording` per captured test, cached per signed-in account:

```ts
{ id, testId, createdAt, videoUri?, status, uploadId?, jobId?, result? }
```

`useRecordings()` (in `storage.ts`) exposes the list + `addRecording` + `remove`,
backed by a single shared in-memory cache so every screen stays in sync.

## Tailwind v3 pin — do not "upgrade"

NativeWind 4.x targets **Tailwind v3**. `tailwindcss` latest is v4 (breaking,
CSS-first config) and will break NativeWind. `package.json` pins
`tailwindcss@3.4.x` on purpose. Leave it until NativeWind v5 ships stable.

## What's intentionally NOT here

Still out of scope: a trained/calibrated keypoints→UPDRS model, Core ML, PDF
export, and landscape recording. See `STORE_SUBMISSION.md` for the remaining
submission work.
