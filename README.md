# Luche RN

React Native + Expo rebuild of the Luche motor-test app (the Swift original lives
in `../v2/Luche/`). This version does **all inference in the cloud** — per-test
recordings are just video captures that get sent to a server for analysis. No
Core ML, no on-device model, no frame buffering.

> Status: **Live cloud pipeline (2026-07-03).** `src/lib/cloud.ts` now talks to
> `feral-api`: presigned R2 upload → Sapiens2 keypoints (serve_luche/RunPod) →
> kinematic MDS-UPDRS heuristic → real score (0–1 severity + 0–4 grade, flagged
> `isEstimate`). Auth is anonymous device-token (`src/lib/api.ts`, no sign-in UI,
> Expo Go-safe); Clerk can replace it later without touching the rest of the app.
> Finger tapping is high-confidence; gait / chair / freezing are best-effort from
> handheld video. Backend design: `$FERAL_SHARED_DOCS/raw/plans/2026-07-02-luche-keypoint-updrs-backend.md`.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Expo SDK 57 (RN 0.86, React 19.2), TypeScript |
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
an **About/Privacy** screen (`/about`) is reachable from the menu.

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
    about.tsx              # Privacy & disclaimer (modal)
  components/              # hand-built, ~8 small pieces (no UI kit)
  lib/
    tests.ts               # the 4 tests (ported from Evaluation.swift)
    types.ts               # Recording / CloudResult / status
    cloud.ts               # <- THE PLACEHOLDER SEAM (replace for real API)
    storage.ts             # AsyncStorage store + lifecycle driver + hooks
    theme.ts               # raw color values for icon/overlay props
```

### The cloud seam (`src/lib/cloud.ts`)

The only module that knows about "the cloud". Today it fakes the lifecycle:

```ts
uploadRecording(uri)      -> Promise<{ jobId }>   // fake delay
pollResult(jobId, testId) -> Promise<CloudResult> // fake delay + sample score
```

`storage.ts` drives a recording through `uploading -> processing -> done`,
persisting each transition. When the real API lands, reimplement these two
functions (multipart POST + poll) and drop the `isDemo` sample labeling. The UI,
persistence, and status pills stay untouched.

### Data model

One `Recording` per captured test, persisted locally:

```ts
{ id, testId, createdAt, videoUri, status, jobId?, result? }
```

`useRecordings()` (in `storage.ts`) exposes the list + `addRecording` + `remove`,
backed by a single shared in-memory cache so every screen stays in sync.

## Tailwind v3 pin — do not "upgrade"

NativeWind 4.x targets **Tailwind v3**. `tailwindcss` latest is v4 (breaking,
CSS-first config) and will break NativeWind. `package.json` pins
`tailwindcss@3.4.x` on purpose. Leave it until NativeWind v5 ships stable.

## What's intentionally NOT here

Present in the Swift app, out of scope for this scaffold: real auth (Clerk),
real upload/inference, Core ML, the observer/data-sharing surface, PDF export,
landscape recording. See `STORE_SUBMISSION.md` for the path to a submittable
build.
