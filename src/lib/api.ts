import { getClerkInstance } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { CLERK_PUBLISHABLE_KEY } from './clerk';

/**
 * Backend client: base URL + auth.
 *
 * Auth is Clerk when the user is signed in (session JWT, verified by feral-api
 * against the same instance's JWKS). If Clerk has no session it falls back to an
 * anonymous device token — so requests always carry a bearer, and the fallback
 * kept the app working before Clerk was wired.
 */
export const API_BASE = 'https://feral-api.ratemepls.com';

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
  const res = await fetch(`${API_BASE}/auth/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) throw new Error(`device auth failed (${res.status})`);
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
  const res = await fetch(`${API_BASE}/me/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role: 'patient' }),
  });
  // 200 created/idempotent, 409 already a patient — both fine. Ignore transient errors.
  if (!res.ok && res.status !== 409) {
    throw new Error(`onboard failed (${res.status})`);
  }
}

/** JSON request with the device bearer token attached. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}
