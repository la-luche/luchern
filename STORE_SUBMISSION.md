# Store submission checklist — Luche RN

Path to a build that passes **App Store** and **Play Store** review. Split into
what's already baked into the code/config vs. what you still have to do outside
the repo. This app records video and scores movement (a health-adjacent domain),
so both stores will scrutinize permissions, privacy, and medical claims.

---

## ✅ Already handled in the repo

| Item | Where |
| --- | --- |
| iOS camera/mic permission usage strings | `app.json` → `plugins.expo-camera.{cameraPermission,microphonePermission}` |
| Android `RECORD_AUDIO` opt-in | `app.json` → `expo-camera.recordAudioAndroid: true` |
| Runtime permission request + graceful "denied" screen | `src/app/record/[id].tsx` (permission gate, Open-Settings fallback) |
| Export-compliance (skip encryption questionnaire) | `app.json` → `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` |
| iPhone-only (no broken iPad review) | `app.json` → `ios.supportsTablet: false` |
| Bundle identifiers | `ai.getferal.luche` (iOS + Android) |
| First-launch medical disclaimer | `src/components/DisclaimerGate.tsx` |
| In-app privacy/about screen | `src/app/about.tsx` |
| Placeholder results labeled **SAMPLE** (not misleading) | `src/app/results/[id].tsx`, `src/lib/cloud.ts` (`isDemo`) |

---

## ⛔ Blockers you must clear before submitting

### 1. Real functionality (the big one)
Both stores reject apps that present **fake data as real** (Apple 2.1/4.2, Play
"minimum functionality" / deceptive-behavior). Two acceptable paths:
- **Ship the real cloud** — replace `src/lib/cloud.ts` with the real upload +
  poll, remove the `isDemo` SAMPLE badge. **← preferred.**
- **Or** submit with results still visibly labeled "Sample / Demo" AND make sure
  no medical claim is implied. Riskier for a health app; only for a beta.

### 2. Live privacy policy
Required by **both** stores for any app that uses the camera. Currently a
placeholder URL in `src/app/about.tsx`:
```
https://getferal.ai/luche-privacy   ← must be a real, reachable page
```
Host it (getferal.ai is already CNAME-served) and confirm the same URL is entered
in App Store Connect + Play Console listings.

### 3. App Store Privacy "nutrition label" (App Store Connect)
Declare data collection. For the scaffold today: **camera/video** used for app
functionality, not linked to identity, not used for tracking. Update when the
real cloud stores video server-side (then it's "collected").

### 4. Play Data Safety form (Play Console)
Same content as #3, different form. Declare camera/mic + whether video leaves the
device. With the real cloud, video **is** collected → declare it and mark
encryption in transit.

### 5. Health app declarations
- **Apple:** be ready for a 1.4.1 / medical-claims prompt. The in-app disclaimer
  ("not a medical device, not for diagnosis") helps; keep store copy free of
  diagnostic claims (no "detects Parkinson's").
- **Play:** if you market any health/medical function, the **Health Apps
  declaration** may apply. Keep listing copy as "movement test recorder / research
  & wellness," not "diagnose."

### 6. Assets & metadata (not code)
- Real app icon + splash (currently Expo placeholders in `assets/`).
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

### Node version note
`react-native@0.86` / `@react-native/codegen` want Node **≥ 20.19.4**; this
machine has 20.19.2. JS bundling and `expo export` work fine, but bump Node
(`nvm install 20.19.4` or newer) before native/EAS builds to avoid engine
failures.

---

## Quick pre-flight

- [ ] `src/lib/cloud.ts` points at the real API (or SAMPLE labels are intact + honest)
- [ ] Privacy policy URL live and matches store listings
- [ ] App Store Privacy label + Play Data Safety filled
- [ ] Real icon/splash, screenshots, description (no diagnostic claims)
- [ ] Node ≥ 20.19.4 for EAS build
- [ ] `npx tsc --noEmit` clean · `npx expo export` succeeds
- [ ] Tested capture → result on a **physical device** (iOS + Android)
