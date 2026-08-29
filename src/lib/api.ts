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
  preferApiBase,
  requestClerkTransportFallback,
  routeRussianStorageUrls,
} from './edge';
import {
  REQUEST_TIMEOUT_MS,
  ApiNetworkError,
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
let tokenRequest: { session: object; promise: Promise<string | null> } | null = null;

type AuthBinding = { session: object; accountId: string | null };

function accountIdForSession(session: object | null | undefined): string | null {
  const value = session as { user?: { id?: unknown }; userId?: unknown } | null | undefined;
  if (typeof value?.user?.id === 'string') return value.user.id;
  return typeof value?.userId === 'string' ? value.userId : null;
}

function assertAuthBinding(binding: AuthBinding): object {
  const clerk = getClerkInstance({ publishableKey: CLERK_PUBLISHABLE_KEY });
  const session = clerk.session;
  const matches = binding.accountId
    ? accountIdForSession(session) === binding.accountId
    : session === binding.session;
  if (!session || !matches) throw new Error('signed-in account changed');
  return session;
}

function shortDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestClerkToken(
  binding: AuthBinding,
  forceRefresh = false,
): Promise<string | null> {
  let fallbackRequested = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // The singleton is configured by ClerkProvider. Deduplicating this work
      // prevents Results, polling, and onboarding from refreshing in parallel.
      const session = assertAuthBinding(binding) as {
        getToken(options?: { skipCache: boolean }): Promise<string | null>;
      };
      const token = await withTimeout(
        session.getToken(forceRefresh || attempt > 0 ? { skipCache: true } : undefined),
        REQUEST_TIMEOUT_MS,
        'refresh session token',
      );
      assertAuthBinding(binding);
      return token;
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

async function clerkToken(binding: AuthBinding, forceRefresh = false): Promise<string | null> {
  const session = assertAuthBinding(binding);
  if (!forceRefresh && tokenRequest?.session === session) return tokenRequest.promise;
  const request = requestClerkToken(binding, forceRefresh);
  const tracked = { session, promise: request };
  tokenRequest = tracked;
  try {
    return await request;
  } finally {
    if (tokenRequest === tracked) tokenRequest = null;
  }
}

/** Bearer token for the signed-in account; never substitute another identity. */
export async function getToken(forceRefresh = false, binding?: AuthBinding): Promise<string> {
  const clerk = getClerkInstance({ publishableKey: CLERK_PUBLISHABLE_KEY });
  const session = clerk.session;
  if (!session) throw new Error('signed-in session unavailable');
  const expected = binding ?? { session, accountId: accountIdForSession(session) };
  const token = await clerkToken(expected, forceRefresh);
  if (!token) throw new Error('signed-in session unavailable');
  return token;
}

/** Idempotently register the signed-in Clerk user as a 'patient'. */
export async function ensurePatientOnboarded(expectedAccountId?: string): Promise<void> {
  try {
    await apiFetch('/me/onboard', {
      method: 'POST',
      body: JSON.stringify({ role: 'patient' }),
    }, expectedAccountId);
  } catch (error) {
    // The endpoint is idempotent; 409 means this account was already onboarded.
    if (error instanceof ApiError && error.status === 409) return;
    throw error;
  }
}

/** Permanently delete the signed-in Luche account and all server-side data. */
export async function deleteAccount(expectedAccountId?: string): Promise<void> {
  await apiFetch<{ status: 'deleted' }>('/me', { method: 'DELETE' }, expectedAccountId);
}

/** JSON request with the current Clerk account bearer attached. */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  expectedAccountId?: string,
): Promise<T> {
  const reqId = requestId();
  const clerk = getClerkInstance({ publishableKey: CLERK_PUBLISHABLE_KEY });
  if (!clerk.session) throw new Error('signed-in session unavailable');
  const sessionAccountId = accountIdForSession(clerk.session);
  if (expectedAccountId && sessionAccountId !== expectedAccountId) {
    throw new Error('signed-in account changed');
  }
  const authBinding: AuthBinding = {
    session: clerk.session,
    accountId: expectedAccountId ?? sessionAccountId,
  };
  for (let authAttempt = 0; authAttempt < 2; authAttempt += 1) {
    let token: string;
    try {
      token = await getToken(authAttempt > 0, authBinding);
    } catch (error) {
      if (isConnectionFailure(error)) {
        throw new ApiNetworkError(path, reqId, error, CANONICAL_CLERK_ORIGIN);
      }
      throw error;
    }

    const { response: res, endpoint, release } = await fetchWithTransport(path, reqId, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Request-ID': reqId,
        ...CLIENT_HEADERS,
        ...(init.headers ?? {}),
      },
    });
    try {
      if (res.status === 401 && authAttempt === 0) {
        recordDiagnostic('api_auth_retry', { requestId: reqId, path });
        continue;
      }
      if (!res.ok) {
        const body = await withTimeout(res.text(), REQUEST_TIMEOUT_MS, 'read error body')
          .catch(() => '');
        recordApiError(reqId, init.method ?? 'GET', path, res.status);
        throw new ApiError(res.status, path, body, init.method ?? 'GET', reqId);
      }
      // fetch resolves on HEADERS; a network that stalls mid-body (RU DPI
      // partial blocking) is aborted by the transport timer, which remains
      // live until release() below.
      const parsed = (await withTimeout(
        res.json(),
        REQUEST_TIMEOUT_MS,
        'read response body',
      )) as T;
      return routeRussianStorageUrls(parsed, endpoint);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Headers arrived but the body stalled or arrived garbled — this base
      // is compromised despite "succeeding". Demote it so the caller's retry
      // takes the other route instead of re-stalling here.
      preferApiBase(endpoint === API_BASE ? FALLBACK_API_BASE : API_BASE);
      throw new ApiNetworkError(path, reqId, error, endpoint);
    } finally {
      release();
    }
  }

  throw new ApiError(401, path, '', init.method ?? 'GET', reqId);
}
