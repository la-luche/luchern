import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Native values identify the installed binary, even when Metro serves a newer
// manifest. Never label an old installation with the next build's config.
export function getAppVersion() {
  return {
    version: Platform.OS === 'web'
      ? Constants.expoConfig?.version ?? null
      : Application.nativeApplicationVersion,
    buildNumber: Application.nativeBuildVersion,
  };
}
