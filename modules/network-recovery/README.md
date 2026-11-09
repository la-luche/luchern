# Network recovery

Normal networking uses the device resolver. After a Luche transport failure,
the app can activate Google Public DNS for five minutes. No Russian relay IP
or alternate Luche hostname is embedded. Google resolver bootstrap addresses
are not application server addresses. URLs, Host/SNI and certificate validation
remain unchanged. No VPN, DNS profile, system DNS preference or new permission
is installed.

`src/lib/networkRecovery.ts` coalesces activation from fetch/auth/API deadlines,
incomplete API bodies, uploads and video. HTTP errors and explicit user cancels
do not trigger recovery. Recovery does not replay writes. Existing read retries
or the existing user retry flow initiate new requests. Web/older native builds
without this module continue using ordinary DNS.

## iOS

`DNSRecovery.swift` first performs a bounded HTTPS reachability/answer check
against Google. It enables Network.framework's default app PrivacyContext only
after that succeeds. Failed probes have a 30-second cooldown. The context
covers URLSession, including React Native, Expo fetch, FileSystem and AVPlayer
name resolution. The app returns to normal resolution after five minutes.
Existing connections/cached answers may survive until reconnect/expiry.

**A preferred system encrypted DNS profile takes precedence over the app's
fallback.** This is not an unconditional resolver override. The reachability
probe itself uses normal URLSession resolution for dns.google; if that fails,
the app leaves its resolver unchanged. Resolver recovery cannot guarantee
access on every network.

The Expo Video patch preserves a wrapped URL transport error in the event
description so the JS player can await recovery before its existing retry.
HTTP, certificate and decoding failures keep their original classification.

## Android

The config plugin installs a custom OkHttp factory before React Native startup.
`RecoveryDns` uses system DNS until activated, then DoH for the three allowed
Luche hosts; if DoH is unavailable, system DNS remains usable. No custom trust
manager or hostname verifier is installed. Native transport failures activate
recovery for subsequent requests, and idle pooled connections are evicted.

Expo fetch already uses the React Native factory. The patch-package changes to
Expo FileSystem (current and legacy APIs) and Expo Video copy only its DNS,
connection pool and event listener into their own clients; their cookies,
headers, timeouts, streaming and request bodies retain their original behavior.
`package.json` explicitly lists `expo-file-system` and `expo-video` under
`expo.autolinking.android.buildFromSource`; otherwise Expo links their bundled
AARs and silently ignores native source patches.

## Checks

From the repo root:

```sh
npm test -- --runInBand src/lib/__tests__/networkRecovery.test.ts
cd android
./gradlew :network-recovery:testDebugUnitTest :expo-file-system:compileDebugKotlin :expo-video:compileDebugKotlin
```

The Android tests include a real local TLS server: a failed normal lookup,
alternate lookup, unchanged Host, and rejection of a certificate for the wrong
hostname. The iOS logic and AVFoundation error classification can be checked
without installing the app:

```sh
xcrun swiftc -parse-as-library modules/network-recovery/ios/DNSRecovery.swift \
  node_modules/expo-video/ios/LuchePlaybackError.swift \
  modules/network-recovery/tests/DNSRecoveryChecks.swift -o /tmp/luche-dns-checks
/tmp/luche-dns-checks --probe
```

This feature requires a new native build. An OTA JavaScript update cannot add
the native module or patched native package code. Google DNS retention is
documented in `PRIVACY.md`; verify App Store Connect declarations before release.
