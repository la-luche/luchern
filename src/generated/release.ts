/**
 * Replaced inside each staged release before Metro starts. Keeping the release
 * identity in a compiled module makes the About hash identify the JS bundle,
 * not the independently fetched Expo manifest.
 */
export const BUNDLE_COMMIT_PREFIX = 'LUCHE_BUNDLE_COMMIT:';

export const BUNDLED_GIT_COMMIT = null as {
  bundleMarker: string;
  message: string;
  url: string;
} | null;
