import { resourceCache as createClerkResourceCache } from '@clerk/clerk-expo/resource-cache';
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

const secureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
const CLERK_CLIENT_JWT_KEY = '__clerk_client_jwt';
const CLERK_SESSION_RESOURCE_PREFIXES = [
  '__clerk_cache_client_',
  '__clerk_cache_session_jwt_',
];
const RESOURCE_CLEAR_TIMEOUT_MS = 5_000;
const memoryTokens = new Map<string, string>();
let secureStoreWrites = Promise.resolve();
type ClerkResourceStore = ReturnType<typeof createClerkResourceCache>;
const clerkResourceStores = new Map<string, ClerkResourceStore>();

function enqueueSecureStoreWrite(write: () => Promise<void>): Promise<void> {
  const queued = secureStoreWrites
    .catch(() => {})
    .then(write);
  secureStoreWrites = queued.catch(() => {});
  return queued;
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
    void enqueueSecureStoreWrite(() => SecureStore.setItemAsync(key, value, secureStoreOptions));
    return Promise.resolve();
  },
  clearToken(key: string) {
    memoryTokens.delete(key);
    return enqueueSecureStoreWrite(() => SecureStore.deleteItemAsync(key, secureStoreOptions));
  },
};

/**
 * Clerk's offline resource cache stores the signed-in client separately from
 * the bearer token. Track the opaque cache keys Clerk actually uses so an
 * offline logout can clear both without depending on package-internal paths.
 */
export function clerkResourceCache(): ClerkResourceStore {
  const store = createClerkResourceCache();
  return {
    async get(key: string) {
      clerkResourceStores.set(key, store);
      return store.get(key);
    },
    async set(key: string, value: string) {
      clerkResourceStores.set(key, store);
      return store.set(key, value);
    },
  };
}

function isSessionResourceKey(key: string): boolean {
  return CLERK_SESSION_RESOURCE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

async function clearResourceKey(key: string, store: ClerkResourceStore): Promise<void> {
  await store.set(key, '');
  const deadline = Date.now() + RESOURCE_CLEAR_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await store.get(key)) === '') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Clerk resource cache did not clear: ${key}`);
}

/** Durably remove every local credential/snapshot that can restore a session. */
export async function clearClerkLocalSession(): Promise<void> {
  const resourceClears = [...clerkResourceStores.entries()]
    .filter(([key]) => isSessionResourceKey(key))
    .map(([key, store]) => clearResourceKey(key, store));
  await Promise.all([
    clerkTokenCache.clearToken(CLERK_CLIENT_JWT_KEY),
    ...resourceClears,
  ]);
}
