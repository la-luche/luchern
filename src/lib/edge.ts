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

let preferredApiBase = PRIMARY_API_BASE;
let clerkTransportFallback: (() => boolean) | null = null;

// A merely eventual 200 is not a healthy direct Clerk path: on affected
// Russian networks the environment request completes in ~600 ms, then one of
// the parallel bootstrap streams hangs. Give direct a real chance first — a
// cold TLS handshake on a normal US network can take ~1 s, and 400 ms exiled
// healthy users to the Russian edge. A genuinely throttled path still misses
// 2 s and selects the edge before ClerkProvider mounts.
const DIRECT_CLERK_PROBE_TIMEOUT_MS = 2_000;
const RUSSIAN_CLERK_PROBE_TIMEOUT_MS = 3_500;

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
    return response.ok;
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
  const direct = await timedProbe(
    `${CANONICAL_CLERK_ORIGIN}/v1/environment`,
    DIRECT_CLERK_PROBE_TIMEOUT_MS,
  );
  if (direct.ok) {
    recordDiagnostic('clerk_transport_selected', {
      transport: 'clerk-direct',
      directProbeMs: direct.ms,
    });
    preferApiBase(PRIMARY_API_BASE);
    return undefined;
  }

  const edge = await timedProbe(
    `${RUSSIAN_CLERK_PROXY}/v1/environment`,
    RUSSIAN_CLERK_PROBE_TIMEOUT_MS,
  );
  if (edge.ok) {
    recordDiagnostic('clerk_transport_selected', {
      transport: 'ru-edge',
      directProbeMs: direct.ms,
      edgeProbeMs: edge.ms,
    });
    preferApiBase(RUSSIAN_API_BASE);
    return RUSSIAN_CLERK_PROXY;
  }

  recordDiagnostic('clerk_transport_selected', {
    transport: 'clerk-direct',
    reason: 'both_probes_failed',
    directProbeMs: direct.ms,
    edgeProbeMs: edge.ms,
  });
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
