export const APP_ORIGIN = 'https://luche.ai';
export const PRIMARY_API_BASE = `${APP_ORIGIN}/api`;
export const CLERK_PROXY_URL = `${APP_ORIGIN}/__clerk`;

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
