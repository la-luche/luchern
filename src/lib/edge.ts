import AsyncStorage from '@react-native-async-storage/async-storage';

import { recordDiagnostic } from './diagnostics';

export const PRIMARY_API_BASE = 'https://feral-api.ratemepls.com';
export const RUSSIAN_EDGE_ORIGIN = 'https://xn--e1alyq.xn--p1ai';
export const RUSSIAN_API_BASE = `${RUSSIAN_EDGE_ORIGIN}/api`;

export const CANONICAL_CLERK_ORIGIN = 'https://clerk.luche.ai';
export const RUSSIAN_CLERK_PROXY = `${RUSSIAN_EDGE_ORIGIN}/__clerk`;

/** Support-log label for an API base — hostnames of our own two backends are
 * not user data, but the generic URL scrubber must never see them either. */
export function apiBaseLabel(base: string | undefined): string {
  if (base === PRIMARY_API_BASE) return 'primary';
  if (base === RUSSIAN_API_BASE || base === RUSSIAN_CLERK_PROXY) return 'ru-edge';
  if (base === CANONICAL_CLERK_ORIGIN) return 'clerk-direct';
  return base == null ? 'unknown' : 'other';
}

/** The transport the last session PROVED out. A probe pass is necessary but
 * not sufficient for direct on throttled RU networks (the probe can succeed
 * while the bootstrap streams hang), so the watchdog's verdict from a past
 * session outranks a probe win — see selectClerkProxyUrl. */
const CLERK_TRANSPORT_KEY = 'luche.clerkTransport.v1';
export type ClerkTransport = 'direct' | 'ru-edge';

export function persistClerkTransport(transport: ClerkTransport): void {
  void AsyncStorage.setItem(CLERK_TRANSPORT_KEY, transport).catch(() => {});
}

async function storedClerkTransport(): Promise<ClerkTransport | null> {
  try {
    const value = await AsyncStorage.getItem(CLERK_TRANSPORT_KEY);
    return value === 'direct' || value === 'ru-edge' ? value : null;
  } catch {
    return null;
  }
}

let preferredApiBase = PRIMARY_API_BASE;
let clerkTransportFallback: (() => boolean) | null = null;

// A merely eventual 200 is not a healthy direct Clerk path: on affected
// Russian networks the environment request completes in ~600 ms, then one of
// the parallel bootstrap streams hangs. Give direct a real chance — a cold
// TLS handshake from a phone routinely needs 2+ s (400 ms and even 2 s exiled
// healthy US users to the edge). Both probes run in parallel and direct wins
// whenever it succeeds, so a wide window costs no extra startup time.
// Sized for reliability, not speed: on RU LTE the edge needs 2-3.5 s just to
// answer a probe, and a window that clips it drops the launch into the
// both-failed default — the worst outcome on such a network. Probes run in
// parallel, so the widest window bounds the total startup wait.
const DIRECT_CLERK_PROBE_TIMEOUT_MS = 5_000;
const RUSSIAN_CLERK_PROBE_TIMEOUT_MS = 8_000;

export function apiBaseOrder(): string[] {
  const other = preferredApiBase === PRIMARY_API_BASE
    ? RUSSIAN_API_BASE
    : PRIMARY_API_BASE;
  return [preferredApiBase, other];
}

export function preferApiBase(base: string): void {
  if (base === PRIMARY_API_BASE || base === RUSSIAN_API_BASE) {
    preferredApiBase = base;
  }
}

export function resetPreferredApiBase(): void {
  preferredApiBase = PRIMARY_API_BASE;
}

/** RootLayout owns ClerkProvider; API code uses this hook when token refresh
 * proves that the direct Clerk route is unusable after its health GET passed. */
export function registerClerkTransportFallback(
  fallback: () => boolean,
): () => void {
  clerkTransportFallback = fallback;
  return () => {
    if (clerkTransportFallback === fallback) clerkTransportFallback = null;
  };
}

export function requestClerkTransportFallback(): boolean {
  return clerkTransportFallback?.() ?? false;
}

async function timedProbe(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; ms: number }> {
  const startedAt = Date.now();
  const ok = await probe(url, timeoutMs);
  return { ok, ms: Date.now() - startedAt };
}

async function probe(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    // Headers alone are not proof of a usable route: carrier DPI has been
    // observed delivering headers in 200 ms and killing the body stream
    // (probe log 2026-08-19). The abort timer is still armed here, so a
    // stalled body fails the probe instead of hanging it.
    await response.text();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pick the Clerk transport before mounting ClerkProvider. Always try the
 * canonical Frontend API first, then fall back to the Russian same-instance
 * proxy. If both health checks are inconclusive (e.g. the device is briefly
 * offline), assume nothing and stay on the canonical route — pinning to the
 * fallback here has locked US users onto an edge their network cannot reach
 * for the whole session.
 */
export async function selectClerkProxyUrl(): Promise<string | undefined> {
  // Both probes race in parallel, but direct has priority: a slow-yet-healthy
  // direct handshake must never lose to a fast edge answer.
  const [stored, direct, edge] = await Promise.all([
    storedClerkTransport(),
    timedProbe(`${CANONICAL_CLERK_ORIGIN}/v1/environment`, DIRECT_CLERK_PROBE_TIMEOUT_MS),
    timedProbe(`${RUSSIAN_CLERK_PROXY}/v1/environment`, RUSSIAN_CLERK_PROBE_TIMEOUT_MS),
  ]);

  // A past session's watchdog demoted direct on this device (RU throttling
  // passes the probe but hangs the bootstrap). Honor that verdict — but only
  // while the edge actually answers, so this can never become a dead end.
  if (stored === 'ru-edge' && edge.ok) {
    recordDiagnostic('clerk_transport_selected', {
      transport: 'ru-edge',
      reason: 'persisted_verdict',
      directProbeMs: direct.ms,
      edgeProbeMs: edge.ms,
    });
    preferApiBase(RUSSIAN_API_BASE);
    return RUSSIAN_CLERK_PROXY;
  }

  if (direct.ok) {
    // Never let a probe win erase a runtime-proven ru-edge verdict: on RU
    // networks the direct probe passes deceptively, and reaching here with a
    // stored verdict only means the edge probe blipped once. Verdict demotion
    // to 'direct' requires runtime proof (the auth/bootstrap flip paths).
    if (stored !== 'ru-edge') persistClerkTransport('direct');
    recordDiagnostic('clerk_transport_selected', {
      transport: 'clerk-direct',
      directProbeMs: direct.ms,
      edgeProbeMs: edge.ms,
    });
    preferApiBase(PRIMARY_API_BASE);
    return undefined;
  }

  if (edge.ok) {
    persistClerkTransport('ru-edge');
    recordDiagnostic('clerk_transport_selected', {
      transport: 'ru-edge',
      directProbeMs: direct.ms,
      edgeProbeMs: edge.ms,
    });
    preferApiBase(RUSSIAN_API_BASE);
    return RUSSIAN_CLERK_PROXY;
  }

  // Both probes failed: nothing was learned, so the stored verdict is the
  // best prior — a slow-but-alive route beats the canonical default that a
  // past session already proved unusable. No verdict → canonical direct.
  const fallback: ClerkTransport = stored ?? 'direct';
  recordDiagnostic('clerk_transport_selected', {
    transport: fallback === 'ru-edge' ? 'ru-edge' : 'clerk-direct',
    reason: 'both_probes_failed',
    directProbeMs: direct.ms,
    edgeProbeMs: edge.ms,
  });
  if (fallback === 'ru-edge') {
    preferApiBase(RUSSIAN_API_BASE);
    return RUSSIAN_CLERK_PROXY;
  }
  preferApiBase(PRIMARY_API_BASE);
  return undefined;
}

function routeStorageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.r2.cloudflarestorage.com')) return url;
    return `${RUSSIAN_EDGE_ORIGIN}/r2${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Route only presigned client-storage fields through the edge that answered. */
export function routeRussianStorageUrls<T>(value: T, apiBase: string): T {
  if (apiBase !== RUSSIAN_API_BASE || value == null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => routeRussianStorageUrls(item, apiBase)) as T;
  }

  const source = value as Record<string, unknown>;
  const routed: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if ((key === 'upload_url' || key === 'video_url') && typeof item === 'string') {
      routed[key] = routeStorageUrl(item);
    } else {
      routed[key] = routeRussianStorageUrls(item, apiBase);
    }
  }
  return routed as T;
}
