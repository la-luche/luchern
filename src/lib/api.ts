import { getClerkInstance } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { CLERK_PUBLISHABLE_KEY } from './clerk';
import { diagnosticErrorData, recordDiagnostic } from './diagnostics';

/**
 * Backend client: base URL + auth.
 *
 * Auth is Clerk when the user is signed in (session JWT, verified by feral-api
 * against the same instance's JWKS). If Clerk has no session it falls back to an
 * anonymous device token — so requests always carry a bearer, and the fallback
 * kept the app working before Clerk was wired.
 */
export const API_BASE = 'https://feral-api.ratemepls.com';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly responseBody: string,
    method: string,
    public readonly requestId: string,
  ) {
    super(`${method} ${path} → ${status}`);
    this.name = 'ApiError';
  }
}

export class ApiNetworkError extends Error {
  constructor(
    public readonly path: string,
    public readonly requestId: string,
    cause: unknown,
  ) {
    super('network request failed', { cause });
    this.name = 'ApiNetworkError';
  }
}

function requestId(): string {
  return `rn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const CLIENT_HEADERS = {
  'X-Luche-Version': Constants.expoConfig?.version ?? 'unknown',
  'X-Luche-Platform': Platform.OS,
};

async function fetchWithNetworkDiagnostic(
  path: string,
  reqId: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    const wrapped = new ApiNetworkError(path, reqId, error);
    recordDiagnostic('api_network_error', {
      requestId: reqId,
      method: init.method ?? 'GET',
      path,
      ...diagnosticErrorData(wrapped),
    });
    throw wrapped;
  }
}

const lastErrorDiagnostic = new Map<string, number>();

function recordApiError(requestId: string, method: string, path: string, status: number) {
  const key = `${method}:${path}:${status}`;
  const now = Date.now();
  const last = lastErrorDiagnostic.get(key) ?? 0;
  // A polling outage can produce the same error every three seconds. Preserve
  // the signal without allowing it to evict every other support event.
  if (now - last < 30_000) return;
  lastErrorDiagnostic.set(key, now);
  recordDiagnostic('api_error', { requestId, method, path, status });
}

const DEVICE_ID_KEY = 'luche.deviceId.v1';
const TOKEN_KEY = 'luche.deviceToken.v1';

let tokenCache: string | null = null;

function randomId(): string {
  // Stable per-install id; stored, so weak randomness is fine. Avoids a crypto dep.
  let s = '';
  for (let i = 0; i < 4; i++) s += Math.random().toString(36).slice(2);
  return `luche-${Date.now().toString(36)}-${s}`;
}

async function getDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = randomId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** Clerk session JWT when signed in, else null. Freshly minted (Clerk refreshes). */
async function clerkToken(): Promise<string | null> {
  try {
    const clerk = getClerkInstance({ publishableKey: CLERK_PUBLISHABLE_KEY });
    if (clerk.session) return await clerk.session.getToken();
  } catch {
    // Clerk not ready — fall through to device token.
  }
  return null;
}

/** Mint (or return the cached) anonymous device bearer token. */
async function deviceToken(): Promise<string> {
  if (tokenCache) return tokenCache;
  const stored = await AsyncStorage.getItem(TOKEN_KEY);
  if (stored) {
    tokenCache = stored;
    return stored;
  }
  const deviceId = await getDeviceId();
  const reqId = requestId();
  const path = '/auth/device';
  const res = await fetchWithNetworkDiagnostic(path, reqId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': reqId, ...CLIENT_HEADERS },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    recordApiError(reqId, 'POST', path, res.status);
    throw new ApiError(res.status, path, body, 'POST', reqId);
  }
  const { token } = (await res.json()) as { token: string };
  tokenCache = token;
  await AsyncStorage.setItem(TOKEN_KEY, token);
  return token;
}

/** Bearer token for API calls: Clerk if signed in, otherwise device token. */
export async function getToken(): Promise<string> {
  return (await clerkToken()) ?? (await deviceToken());
}

/** Idempotently register the signed-in Clerk user as a 'patient'. */
export async function ensurePatientOnboarded(): Promise<void> {
  const token = await clerkToken();
  if (!token) return;
  const reqId = requestId();
  const path = '/me/onboard';
  const res = await fetchWithNetworkDiagnostic(path, reqId, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Request-ID': reqId,
      ...CLIENT_HEADERS,
    },
    body: JSON.stringify({ role: 'patient' }),
  });
  // 200 created/idempotent, 409 already a patient — both fine. Ignore transient errors.
  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => '');
    recordApiError(reqId, 'POST', path, res.status);
    throw new ApiError(res.status, path, body, 'POST', reqId);
  }
}

/** JSON request with the device bearer token attached. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const reqId = requestId();
  const res = await fetchWithNetworkDiagnostic(path, reqId, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Request-ID': reqId,
      ...CLIENT_HEADERS,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    recordApiError(reqId, init.method ?? 'GET', path, res.status);
    throw new ApiError(res.status, path, body, init.method ?? 'GET', reqId);
  }
  return (await res.json()) as T;
}
