export const APP_ORIGIN = 'https://luche.ai';
export const PRIMARY_API_BASE = `${APP_ORIGIN}/api`;
export const CLERK_PROXY_URL = `${APP_ORIGIN}/__clerk`;

/** Validate after API storage routing, before giving native code any video bytes. */
export function validatedUploadUrl(value: unknown): string {
  const invalid = () => new Error('untrusted upload destination');
  if (typeof value !== 'string' || /[\s\\]/.test(value)) throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    url.origin !== APP_ORIGIN || url.username || url.password || url.hash ||
    !url.pathname.startsWith('/r2/')
  ) throw invalid();
  return url.href;
}

/** Stable, non-sensitive labels for exported support logs. */
export function apiBaseLabel(base: string | undefined): string {
  if (base === PRIMARY_API_BASE) return 'api';
  if (base === CLERK_PROXY_URL) return 'auth';
  return base == null ? 'unknown' : 'other';
}

function routeStorageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.r2.cloudflarestorage.com')) return url;
    return `${APP_ORIGIN}/r2${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Keep signed client transfers on the same application origin. */
export function routeStorageUrls<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(routeStorageUrls) as T;

  const routed: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    routed[key] = (key === 'upload_url' || key === 'video_url') && typeof item === 'string'
      ? routeStorageUrl(item)
      : routeStorageUrls(item);
  }
  return routed as T;
}
