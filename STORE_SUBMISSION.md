# Store submission checklist — Luche RN

Path to a build that passes **App Store** and **Play Store** review. Split into
what's already baked into the code/config vs. what you still have to do outside
the repo. This app records video and scores movement (a health-adjacent domain),
so both stores will scrutinize permissions, privacy, and medical claims.

---

## ✅ Already handled in the repo

| Item | Where |
| --- | --- |
| Camera permission usage string | `app.json` → `plugins.expo-camera.cameraPermission` |
| Audio disabled | `microphonePermission: false`, `recordAudioAndroid: false`, camera `mute`; `android.blockedPermissions` removes transitive microphone/storage/overlay declarations from the final manifest |
| Runtime permission request + graceful "denied" screen | `src/app/record/[id].tsx` (permission gate, Open-Settings fallback) |
| Export-compliance (skip encryption questionnaire) | `app.json` → `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` |
| iPhone-only (no broken iPad review) | `app.json` → `ios.supportsTablet: false` |
| Bundle identifiers | `ai.getferal.luche` (iOS + Android) |
| First-launch medical disclaimer | `src/components/DisclaimerGate.tsx` |
| In-app privacy/about screen | `src/app/about.tsx` |
| Automated results labeled **EXPERIMENTAL ESTIMATE · NOT A DIAGNOSIS** | `src/app/results/[id].tsx`, `src/lib/i18n/*` |
| Durable local recording + local/server deletion flow | `src/lib/recordingFiles.ts`, `feral-api DELETE /trials/<id>` |
| In-app account deletion with warning, 5-second countdown, final confirmation | `src/app/about.tsx`, `feral-api DELETE /me` |
| Public deletion-request page | `https://luche.ai/delete-account` |

---

## ⛔ Blockers you must clear before submitting

### 1. Unvalidated automated grades
The keypoint extraction is real, but keypoints→UPDRS uses hand-written,
uncalibrated thresholds. Keep estimates explicitly experimental and avoid store
copy implying clinical validation. Prefer exposing measured movement features
until a labeled evaluation exists.

### 2. Store listing URLs
Use `https://luche.ai/privacy-policy` for the privacy policy and
`https://luche.ai/delete-account` for Google Play's account-deletion URL.
Confirm both public routes are reachable after every website deploy.

### 3. App Store Privacy "nutrition label" (App Store Connect)
Declare account identifiers, uploaded user video, derived keypoints/results, and
diagnostics shared voluntarily by the user. Video is linked to the signed-in
account for ownership/access control. It is not used for tracking.

### 4. Play Data Safety form (Play Console)
Same content as #3, different form. Declare camera (not microphone), account
identifiers, and that video leaves the device over encrypted transport.

### 5. Health app declarations
- **Apple:** be ready for a 1.4.1 / medical-claims prompt. The in-app disclaimer
  ("not a medical device, not for diagnosis") helps; keep store copy free of
  diagnostic claims (no "detects Parkinson's").
- **Play:** if you market any health/medical function, the **Health Apps
  declaration** may apply. Keep listing copy as "movement test recorder / research
  & wellness," not "diagnose."

### 6. Assets & metadata (not code)
- Confirm the final app icon + splash and produce store screenshots.
- Screenshots per device size, description, keywords, support URL, age rating.

---

## Build & submit (EAS)

```bash
npm i -g eas-cli
eas login
eas build:configure
eas build --platform ios       # → App Store Connect
eas build --platform android   # → Play Console (.aab)
eas submit -p ios
eas submit -p android
```

### Direct Android beta APK

The public Android beta is also available as a signed APK from
`https://luche.ai/downloads/luche-android.apk`. Build it with the `preview`
profile:

```bash
eas build --platform android --profile preview
```

That profile explicitly selects `android.buildType: apk`, uses EAS internal
distribution signing, and increments the remote Android `versionCode` on every
build. Keep using the EAS-managed keystore so users can install each new APK
over the previous release. The website repo README and the shared Pi runbook
contain the atomic publish commands for replacing the stable download.

### Node version note
Use the Node version supported by the current Expo SDK 54 toolchain. This app is
intentionally not being upgraded to SDK 57 until the required iOS Expo client is
available.

---

## Quick pre-flight

- [ ] Experimental result labeling is intact and honest
- [ ] Matching `feral-api` deletion endpoints are deployed and tested
- [ ] Privacy-policy and account-deletion URLs are live and match store listings
- [ ] App Store Privacy label + Play Data Safety filled
- [ ] Final icon/splash, screenshots, description (no diagnostic claims)
- [ ] `npx tsc --noEmit` clean · `npx expo export` succeeds
- [ ] Tested capture → result on a **physical device** (iOS + Android)
