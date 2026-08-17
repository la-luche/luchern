const mockSecureValues = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'after-first-unlock',
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureValues.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureValues.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureValues.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock('@clerk/clerk-expo/resource-cache', () => ({
  resourceCache: jest.fn(() => {
    const values = new Map<string, string>();
    return {
      get: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        values.set(key, value);
        return Promise.resolve();
      }),
    };
  }),
}));

import * as SecureStore from 'expo-secure-store';

import {
  clearClerkLocalSession,
  clerkResourceCache,
  clerkTokenCache,
} from '../clerk';

describe('Clerk local session storage', () => {
  beforeEach(() => {
    mockSecureValues.clear();
    jest.clearAllMocks();
  });

  it('clears the bearer, client snapshot, and session snapshot but keeps environment data', async () => {
    const client = clerkResourceCache();
    const session = clerkResourceCache();
    const environment = clerkResourceCache();
    const clientKey = '__clerk_cache_client_uYWkk';
    const sessionKey = '__clerk_cache_session_jwt_uYWkk';
    const environmentKey = '__clerk_cache_environment_uYWkk';

    await client.set(clientKey, '{"signedIn":true}');
    await session.set(sessionKey, 'session-jwt');
    await environment.set(environmentKey, '{"displayConfig":{}}');
    await clerkTokenCache.saveToken('__clerk_client_jwt', 'client-jwt');

    await clearClerkLocalSession();

    await expect(client.get(clientKey)).resolves.toBe('');
    await expect(session.get(sessionKey)).resolves.toBe('');
    await expect(environment.get(environmentKey)).resolves.toBe('{"displayConfig":{}}');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      '__clerk_client_jwt',
      expect.objectContaining({ keychainAccessible: 'after-first-unlock' }),
    );
  });
});
