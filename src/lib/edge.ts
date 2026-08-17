export const PRIMARY_API_BASE = 'https://feral-api.ratemepls.com';
export const RUSSIAN_EDGE_ORIGIN = 'https://xn--e1alyq.xn--p1ai';
export const RUSSIAN_API_BASE = `${RUSSIAN_EDGE_ORIGIN}/api`;

export const CANONICAL_CLERK_ORIGIN = 'https://clerk.luche.ai';
export const RUSSIAN_CLERK_PROXY = `${RUSSIAN_EDGE_ORIGIN}/__clerk`;

let preferredApiBase = PRIMARY_API_BASE;

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
 * Pick the Clerk transport before mounting ClerkProvider. Both probes start at
 * once, but the canonical Frontend API gets a short preference window. This
 * keeps the normal path direct while automatically selecting the Russian
 * same-instance proxy when the direct route is blocked.
 */
export async function selectClerkProxyUrl(): Promise<string | undefined> {
  const direct = probe(`${CANONICAL_CLERK_ORIGIN}/.well-known/jwks.json`, 1_600);
  const russian = probe(`${RUSSIAN_CLERK_PROXY}/.well-known/jwks.json`, 3_500);

  if (await direct) {
    preferApiBase(PRIMARY_API_BASE);
    return undefined;
  }
  if (await russian) {
    preferApiBase(RUSSIAN_API_BASE);
    return RUSSIAN_CLERK_PROXY;
  }
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
