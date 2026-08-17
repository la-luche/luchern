export const PRIMARY_API_BASE = 'https://feral-api.ratemepls.com';
export const RUSSIAN_EDGE_ORIGIN = 'https://xn--e1alyq.xn--p1ai';
export const RUSSIAN_API_BASE = `${RUSSIAN_EDGE_ORIGIN}/api`;

export const CANONICAL_CLERK_ORIGIN = 'https://clerk.luche.ai';
export const RUSSIAN_CLERK_PROXY = `${RUSSIAN_EDGE_ORIGIN}/__clerk`;

let preferredApiBase = PRIMARY_API_BASE;
let clerkTransportFallback: (() => boolean) | null = null;

// A merely eventual 200 is not a healthy direct Clerk path: on affected
// Russian networks the environment request completes in ~600 ms, then one of
// the parallel bootstrap streams hangs. Give direct a short first chance; a
// normal/VPN route wins it, while a throttled path selects the Russian edge
// before ClerkProvider can enter a half-restored state.
const DIRECT_CLERK_PROBE_TIMEOUT_MS = 400;
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
 * proxy. If both health checks are inconclusive, prefer the fallback: a later
 * explicit retry can still switch back to direct.
 */
export async function selectClerkProxyUrl(): Promise<string | undefined> {
  if (await probe(`${CANONICAL_CLERK_ORIGIN}/v1/environment`, DIRECT_CLERK_PROBE_TIMEOUT_MS)) {
    preferApiBase(PRIMARY_API_BASE);
    return undefined;
  }
  if (await probe(`${RUSSIAN_CLERK_PROXY}/v1/environment`, RUSSIAN_CLERK_PROBE_TIMEOUT_MS)) {
    preferApiBase(RUSSIAN_API_BASE);
    return RUSSIAN_CLERK_PROXY;
  }

  preferApiBase(RUSSIAN_API_BASE);
  return RUSSIAN_CLERK_PROXY;
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
