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

/**
 * Direct Luche edge used by clients in regions where Cloudflare is throttled
 * or blocked. Keep the override for local/staging work; production builds use
 * the Hetzner gateway by default.
 */
export const LUCHE_GATEWAY_BASE = (
  process.env.EXPO_PUBLIC_LUCHE_GATEWAY_URL ?? 'https://gateway.luche.ai'
).replace(/\/+$/, '');

export const CLERK_PROXY_URL = (
  process.env.EXPO_PUBLIC_CLERK_PROXY_URL ?? 'https://luche.ai/__clerk'
).replace(/\/+$/, '');

const secureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
const memoryTokens = new Map<string, string>();
let secureStoreWrites = Promise.resolve();

function enqueueSecureStoreWrite(write: () => Promise<void>) {
  secureStoreWrites = secureStoreWrites
    .catch(() => {})
    .then(write)
    .catch(() => {});
}

/**
 * Clerk token cache backed by SecureStore with an immediate in-memory layer.
 *
 * Clerk awaits saveToken from its response hook. A slow Android keystore must
 * not leave a completed email-code sign-in stuck on "Verifying…", so writes
 * are serialized in the background while subsequent requests read the fresh
 * token from memory.
 */
export const clerkTokenCache = {
  async getToken(key: string) {
    const memoryToken = memoryTokens.get(key);
    if (memoryToken) return memoryToken;
    try {
      const token = await SecureStore.getItemAsync(key, secureStoreOptions);
      if (token && !memoryTokens.has(key)) memoryTokens.set(key, token);
      return token;
    } catch {
      return null;
    }
  },
  saveToken(key: string, value: string) {
    memoryTokens.set(key, value);
    enqueueSecureStoreWrite(() => SecureStore.setItemAsync(key, value, secureStoreOptions));
    return Promise.resolve();
  },
  clearToken(key: string) {
    memoryTokens.delete(key);
    enqueueSecureStoreWrite(() => SecureStore.deleteItemAsync(key, secureStoreOptions));
    return Promise.resolve();
  },
};
