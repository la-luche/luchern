# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

# Shared iOS and Android versions

Use `npm run ios` / `npm run android` for development builds and `npm run build:ios`, `npm run build:android`, or `npm run build:all` for local EAS builds. These reserve a version automatically. Before a direct Xcode/Gradle build, run `npm run build:prepare -- ios` (or `android` / `all`) exactly once, then `npm run build:check`. Do not override native version numbers manually.

`build-version.json` owns the version and integer build number for both platforms. A matching counterpart build of unchanged source reuses the pair; rebuilding a platform or changing source increments both the patch version and build number. Failed builds consume their reservation. Commit the version files with the source, and pull before preparing on another machine. EAS must keep local versioning and autoIncrement disabled. Builds and binary uploads remain local-only.

Native builds must retain the `with-build-version` plugin guards. Run `npm run build:verify -- <artifact.app|artifact.ipa|artifact.apk>` before installing or uploading any manually prepared artifact. This reads the actual native binary metadata; changing the Expo manifest alone does not constitute a versioned build. App displays and diagnostics must use expo-application native versions, never the development manifest on iOS/Android.
