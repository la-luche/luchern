import * as SecureStore from 'expo-secure-store';

/**
 * Clerk config. The publishable key is public by design (shared with mobile +
 * web). The Pi backend verifies session JWTs against this production instance's
 * JWKS.
 *
 * Sign-in is email one-time-code (the only first factor enabled on the instance)
 * — works in Expo Go (no native module beyond expo-secure-store).
 */
export const CLERK_PUBLISHABLE_KEY =
  'pk_live_Y2xlcmsubHVjaGUuYWkk';

/** Token cache backed by the device keychain (expo-secure-store). */
export const clerkTokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // non-fatal — Clerk falls back to in-memory
    }
  },
  async clearToken(key: string) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // ignore
    }
  },
};
