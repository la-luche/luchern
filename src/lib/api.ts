import { getClerkInstance } from '@clerk/clerk-expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { CLERK_PUBLISHABLE_KEY } from './clerk';
import { isConnectionFailure, withTimeout } from './connectivity';
import { recordDiagnostic } from './diagnostics';
import {
  CANONICAL_CLERK_ORIGIN,
  PRIMARY_API_BASE,
  RUSSIAN_API_BASE,
  requestClerkTransportFallback,
  routeRussianStorageUrls,
} from './edge';
import {
  REQUEST_TIMEOUT_MS,
  ApiNetworkError,
  ApiTimeoutError,
  fetchWithTransport,
} from './transport';

export { ApiNetworkError, ApiTimeoutError } from './transport';

/**
 * Backend client: base URL + auth.
 *
 * Auth is always the currently signed-in Clerk account. Falling back to the
 * retired anonymous device identity would silently put uploads in a different
 * account and break cross-device history.
 */
export const API_BASE = PRIMARY_API_BASE;
export const FALLBACK_API_BASE = RUSSIAN_API_BASE;

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

function requestId(): string {
  return `rn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const CLIENT_HEADERS = {
  'X-Luche-Version': Constants.expoConfig?.version ?? 'unknown',
  'X-Luche-Platform': Platform.OS,
};

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

/** Clerk session JWT when signed in, else null. Freshly minted (Clerk refreshes). */
let tokenRequest: Promise<string | null> | null = null;

function shortDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestClerkToken(): Promise<string | null> {
  let fallbackRequested = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // The singleton is configured by ClerkProvider. Deduplicating this work
      // prevents Results, polling, and onboarding from refreshing in parallel.
      const clerk = getClerkInstance({ publishableKey: CLERK_PUBLISHABLE_KEY });
      if (!clerk.session) return null;
      return await withTimeout(
        clerk.session.getToken(attempt > 0 ? { skipCache: true } : undefined),
        REQUEST_TIMEOUT_MS,
        'refresh session token',
      );
    } catch (error) {
      if (!isConnectionFailure(error)) return null;
      if (!fallbackRequested) {
        const switched = requestClerkTransportFallback();
        fallbackRequested = true;
        recordDiagnostic('clerk_transport_fallback_requested', { switched });
        if (attempt === 0) {
          // Give a direct -> Russian ClerkProvider remount one render turn; on
          // the Russian route this simply lets the failed socket finish closing.
          await shortDelay(switched ? 500 : 100);
          continue;
        }
      }
      throw error;
    }
  }
  return null;
}

async function clerkToken(): Promise<string | null> {
  if (tokenRequest) return tokenRequest;
  const request = requestClerkToken();
  tokenRequest = request;
  try {
    return await request;
  } finally {
    if (tokenRequest === request) tokenRequest = null;
  }
}

/** Bearer token for the signed-in account; never substitute another identity. */
export async function getToken(): Promise<string> {
  const token = await clerkToken();
  if (!token) throw new Error('signed-in session unavailable');
  return token;
}

/** Idempotently register the signed-in Clerk user as a 'patient'. */
export async function ensurePatientOnboarded(): Promise<void> {
  try {
    await apiFetch('/me/onboard', {
      method: 'POST',
      body: JSON.stringify({ role: 'patient' }),
    });
  } catch (error) {
    // The endpoint is idempotent; 409 means this account was already onboarded.
    if (error instanceof ApiError && error.status === 409) return;
    throw error;
  }
}

/** Permanently delete the signed-in Luche account and all server-side data. */
export async function deleteAccount(): Promise<void> {
  await apiFetch<{ status: 'deleted' }>('/me', { method: 'DELETE' });
}

/** JSON request with the current Clerk account bearer attached. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const reqId = requestId();
  for (let authAttempt = 0; authAttempt < 2; authAttempt += 1) {
    let token: string;
    try {
      token = await getToken();
    } catch (error) {
      if (isConnectionFailure(error)) {
        throw new ApiNetworkError(path, reqId, error, CANONICAL_CLERK_ORIGIN);
      }
      throw error;
    }

    const { response: res, endpoint } = await fetchWithTransport(path, reqId, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Request-ID': reqId,
        ...CLIENT_HEADERS,
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 401 && authAttempt === 0) {
      recordDiagnostic('api_auth_retry', { requestId: reqId, path });
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      recordApiError(reqId, init.method ?? 'GET', path, res.status);
      throw new ApiError(res.status, path, body, init.method ?? 'GET', reqId);
    }
    return routeRussianStorageUrls((await res.json()) as T, endpoint);
  }

  throw new ApiError(401, path, '', init.method ?? 'GET', reqId);
}
