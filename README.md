# Luche RN

Active React Native + Expo implementation of the Luche motor-test app. The
original Swift client is retired. Movement scoring runs in the cloud. Optional pre-upload
privacy processing is the only on-device inference: a small bundled pose stack
locates face and body regions before a sanitized video is written.

> Status: **Experimental cloud pipeline.** `src/lib/cloud.ts` talks to
> `feral-api`: presigned video upload → pose keypoints →
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
npm run ios          # or: npm run android
# For later JS-only edits with the development build installed:
npx expo start --dev-client
```

Luche requires a **native development build** because its custom native modules
are not included in Expo Go. Camera recording also requires a real device.
The `go.luche.ai` preview and automatic preview deployments were retired.

### App version and builds

Account shows the installed binary’s version and build number near the top, for example `Version 1.0.2 (Build 37)`. It reads native metadata, so a newer Metro manifest cannot relabel an older installation.

`build-version.json` is the shared counter for iOS and Android. The build commands increment the patch version and build number automatically. Building the other platform from unchanged source reuses the same pair; building a platform again, or building changed source, advances it. Failed attempts consume a number. `npm run build:all` reserves one pair and builds both platforms sequentially on this Mac.

Use `npm run build:ios` and `npm run build:android` for local EAS builds; profile arguments can follow `--`. Before a direct Xcode or Gradle invocation, run `npm run build:prepare -- ios` (or `android` / `all`) once. Preparation synchronizes app.json, package versions, and existing generated native projects without a clean prebuild. `npm run build:check` detects stale values. Pull before preparing on another machine and commit the counter with the source. EAS uses local versions and never increments the two platform counters independently.

Native Xcode/Gradle guards reject stale source or metadata. Local EAS commands verify the finished IPA/APK before reporting success. For a manually prepared artifact, run `npm run build:verify -- path/to/Luche.app` (also supports IPA and APK) before installation or upload. The verifier checks the bundle ID and actual native version/build fields. EAS validates again after dependency installation; it does not depend on development-only tools being installed beforehand.

Useful checks:

```bash
npx tsc --noEmit                    # typecheck
npm test -- --runInBand             # regression suite
npx expo export --platform ios      # bundle smoke test (no device needed)
npx expo export --platform android
```

### Adjust instruction-video framing

Run `npm run framing`, then open
`http://localhost:4173/tools/video-framing/`. The desktop tool uses the real
demo clips and instruction overlay. Trackpad-pinch or scroll to zoom, drag to
reposition, and copy the source-ready `demoFraming` value into the matching test
in `src/lib/tests.ts`. Drafts persist in the browser. Framing uses normalized
screen offsets, so the same values work across device sizes.

## Architecture

### Screen flow

```
Menu → Person → Checkup or individual test → Instructions → Recording → Review
  ├─ History → Checkups / Tests → Checkup / Test history / Recording detail
  └─ Account → Profile, sharing, privacy, language, support
```

The first launch asks for a language (English, Spanish, Italian, Russian, or
Simplified Chinese). A **medical disclaimer** appears once per fresh app launch,
without repeating after switching apps. Email-code authentication checks approval
before sending a code; unapproved users can request access through the waitlist.

The person picker reuses personal and owned guest profiles. Shared people appear
only in history and remain read-only. History remembers the selected person and
Checkups/Tests tab, and provides profile editing and owned-guest deletion.

Recording shows local anatomical guides, which are never burned into the video.
Palm turns stop after 10 seconds and hands at rest after 20 seconds. Other tests
use manual stop with a 120-second safety limit. A checkup clip starts processing
as soon as capture finishes; a retake preserves the earlier attempt as an
individual test. Standalone tests wait for confirmation on the review screen.

The About/Profile screen also owns irreversible account deletion: an explicit
warning, cancellable five-second countdown, and separate final confirmation
call `DELETE /me`, then clear local account files and state. Public instructions
and an email fallback live at `https://luche.ai/delete-account`.

### Directory map

```
src/
  app/                     # expo-router screens (one file = one route)
    _layout.tsx            # language, disclaimer, auth, navigation, notifications
    index.tsx              # Menu
    people.tsx             # personal, owned guest, and shared history subjects
    edit-user.tsx          # owned profile editing and guest deletion
    test/[id].tsx          # Instructions
    record/[id].tsx        # Camera + Start/End
    results/index.tsx      # shared HistoryScreen: Checkups / Tests
    results/test/[testId].tsx # history for one test type
    results/[id].tsx       # Playback + cloud-analysis panel
    checkups/[id].tsx      # full-checkup results
    about.tsx              # Account, sharing, privacy, and support
  components/              # shared screens, controls, gates, recording overlay
  lib/
    tests.ts               # eight movement tests and guided checkup order
    types.ts               # Recording / CloudResult / status
    cloud.ts               # upload, trial creation, and result polling
    storage.ts             # AsyncStorage store + lifecycle driver + hooks
    backgroundRuntime.ts   # native execution lease for queued work
    resultNotifications.ts # account-scoped local completion notifications
    theme.ts               # raw color values for icon/overlay props
modules/
  face-blur/               # native on-device de-identification
  background-work/         # native processing time and heartbeat
  network-recovery/        # app-only DNS recovery after connection failure
```

### The cloud seam (`src/lib/cloud.ts`)

This module separates the expensive byte upload from the small idempotent
trial-creation call:

```ts
uploadRecording(uri, testId)       -> Promise<{ uploadId }>
createAnalysisTrial(uploadId, ...) -> Promise<{ jobId }>
pollResult(jobId, testId)          -> Promise<CloudResult>
```

`storage.ts` drives `draft -> preparing -> uploading -> processing -> done`, persists the upload ID
immediately after the video reaches R2, and persists the job ID before polling.
This makes relaunch/retry avoid retransmitting a completed upload. It also
hydrates metadata from `GET /me/trials`, keeps uploaded videos locally for
three days, and requests a signed cloud URL when an older video is opened.

De-identification defaults to enabled for new preferences, with both face and
background protection. Existing explicit preferences are respected, and Account
can disable it. Uploads identify whether their artifact is de-identified or original.
The local Expo module runs the bundled 4.33M-parameter RTMDet-nano + RTMPose-t
exp-0012 stack on every decoded frame. Face boxes use COCO-17 head keypoints,
shoulder fallback, and a top-of-body fallback; the renderer applies a coarse
four-block mosaic followed by strong blur. The expanded largest-person region
stays clear while the background is coarsely pixelated and blurred. A missed
person frame is fully redacted rather than filled with a stale box. Inference
uses ONNX Runtime on iOS and Android with no SDK key, model download, or network
license check. Luche does not identify which person is the patient.

When protection is enabled, the sanitized URI and local original URI are
persisted separately; only the sanitized video uploads. The original remains
available locally for viewing or sharing until deletion or logout. If protection
is disabled when a recording is staged, its original video uploads instead.
The recording directory is excluded from iCloud backup, and Android app backup
is disabled. A failed privacy-processing job stays blocked for explicit retry.

### Background work and connection recovery

The queue acquires a native execution lease for de-identification, upload, and
polling. Android uses a foreground service; iOS 26 uses continued processing
when available and otherwise falls back to limited background time. Expiration
cancels active work, and interrupted privacy processing remains resumable.
Completion notifications are local, account-scoped, and deduplicated; a checkup
is ready only when all expected tests have results. Force-stop or OS termination
can delay notification until the app runs again.

Requests use the canonical Luche hostname. After a connection failure, the
native recovery module can temporarily enable app-only HTTPS DNS recovery;
ambiguous writes are not automatically replayed. See
[`modules/network-recovery/README.md`](modules/network-recovery/README.md) for
transport coverage and platform limitations.

### Data model

One `Recording` per captured test, cached per signed-in account:

```ts
{ id, testId, createdAt, videoUri?, originalVideoUri?, status, uploadId?, jobId?, result? }
```

`useRecordings()` stages each completed camera file before review, maintains
two alternating per-record recovery manifests plus the aggregate index, and
exposes finalize/remove operations through one shared cache.

## Tailwind v3 pin — do not "upgrade"

NativeWind 4.x targets **Tailwind v3**. `tailwindcss` latest is v4 (breaking,
CSS-first config) and will break NativeWind. `package.json` pins
`tailwindcss@3.4.x` on purpose. Leave it until NativeWind v5 ships stable.

## What's intentionally NOT here

Still out of scope: a trained/calibrated keypoints→UPDRS model, Core ML, PDF
export, and landscape recording. See `STORE_SUBMISSION.md` for the remaining
submission work.
