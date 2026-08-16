import { getClerkInstance } from '@clerk/clerk-expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { CLERK_PROXY_URL, CLERK_PUBLISHABLE_KEY, LUCHE_GATEWAY_BASE } from './clerk';
import { isConnectionFailure, withTimeout } from './connectivity';
import { diagnosticErrorData, recordDiagnostic } from './diagnostics';

/**
 * Backend client: base URL + auth.
 *
 * Auth is always the currently signed-in Clerk account. Falling back to the
 * retired anonymous device identity would silently put uploads in a different
 * account and break cross-device history.
 */
export const API_BASE = `${LUCHE_GATEWAY_BASE}/api`;
export const LEGACY_API_BASE = 'https://feral-api.ratemepls.com';

const REQUEST_TIMEOUT_MS = 8_000;
const FALLBACK_TIMEOUT_MS = 5_000;
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);

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
    public readonly endpoint?: string,
  ) {
    super('network request failed', { cause });
    this.name = 'ApiNetworkError';
  }
}

export class ApiTimeoutError extends Error {
  constructor(
    public readonly path: string,
    public readonly requestId: string,
    public readonly endpoint: string,
  ) {
    super('network request timed out');
    this.name = 'ApiTimeoutError';
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
  const method = (init.method ?? 'GET').toUpperCase();
  const endpoints = IDEMPOTENT_METHODS.has(method)
    ? [...new Set([API_BASE, LEGACY_API_BASE])]
    : [API_BASE];
  let lastError: unknown;

  for (const [index, endpoint] of endpoints.entries()) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (init.signal?.aborted) controller.abort();
    else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeoutMs = index === 0 ? REQUEST_TIMEOUT_MS : FALLBACK_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await fetch(`${endpoint}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      const wrapped = timedOut
        ? new ApiTimeoutError(path, reqId, endpoint)
        : new ApiNetworkError(path, reqId, error, endpoint);
      lastError = wrapped;
      recordDiagnostic('api_network_error', {
        requestId: reqId,
        method,
        path,
        endpoint,
        timedOut,
        fallbackAvailable: index < endpoints.length - 1,
        ...diagnosticErrorData(wrapped),
      });
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw lastError ?? new ApiNetworkError(path, reqId, null);
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

/** Clerk session JWT when signed in, else null. Freshly minted (Clerk refreshes). */
async function clerkToken(): Promise<string | null> {
  try {
    // The singleton is configured by ClerkProvider, including its proxy URL.
    const clerk = getClerkInstance({ publishableKey: CLERK_PUBLISHABLE_KEY });
    if (clerk.session) {
      return await withTimeout(
        clerk.session.getToken(),
        REQUEST_TIMEOUT_MS,
        'refresh session token',
      );
    }
  } catch (error) {
    if (isConnectionFailure(error)) throw error;
    // Clerk can be briefly unavailable while its provider restores a session.
  }
  return null;
}

/** Bearer token for the signed-in account; never substitute another identity. */
export async function getToken(): Promise<string> {
  const token = await clerkToken();
  if (!token) throw new Error('signed-in session unavailable');
  return token;
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

/** Permanently delete the signed-in Luche account and all server-side data. */
export async function deleteAccount(): Promise<void> {
  await apiFetch<{ status: 'deleted' }>('/me', { method: 'DELETE' });
}

/** JSON request with the current Clerk account bearer attached. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const reqId = requestId();
  let token: string;
  try {
    token = await getToken();
  } catch (error) {
    if (isConnectionFailure(error)) {
      throw new ApiNetworkError(path, reqId, error, CLERK_PROXY_URL);
    }
    throw error;
  }
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
