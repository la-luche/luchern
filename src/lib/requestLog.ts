import { recordDiagnostic } from './diagnostics';

/**
 * Records which backend host each request ACTUALLY hit — not which transport
 * the selection logic chose. Added after a debugging session where the two
 * disagreed for weeks (clerk-expo dropped proxyUrl, so "ru-edge selected"
 * sessions still sent every Clerk call direct) and the exported diagnostics
 * could not show it. Runs in release builds.
 *
 * Noise control: every non-GET is recorded; GETs only when they fail or take
 * longer than SLOW_GET_MS (token refreshes fire constantly and would flush
 * the 200-event ring).
 */
const SLOW_GET_MS = 10_000;

const ROUTE_BY_HOST: Record<string, string> = {
  'clerk.luche.ai': 'clerk-direct',
  'xn--e1alyq.xn--p1ai': 'ru-edge',
  'feral-api.ratemepls.com': 'primary',
};

let installed = false;

export function installRequestLog(): void {
  if (installed) return;
  installed = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: any, init?: any) => {
    let host = '';
    let path = '';
    try {
      const url = new URL(typeof input === 'string' ? input : (input?.url ?? String(input)));
      host = url.hostname;
      path = url.pathname;
    } catch {
      // non-URL input (Request polyfill edge cases) — pass through untouched
    }
    const route = ROUTE_BY_HOST[host];
    if (!route) return realFetch(input, init);

    const method = String(
      init?.method ?? (typeof input === 'object' ? input?.method : undefined) ?? 'GET',
    ).toUpperCase();
    if (__DEV__) console.log(`[req] → ${method} ${host}${path}`);
    const startedAt = Date.now();
    try {
      const response = await realFetch(input, init);
      const ms = Date.now() - startedAt;
      if (__DEV__) console.log(`[req] ← ${response.status} ${method} ${host}${path} ${ms}ms`);
      if (method !== 'GET' || !response.ok || ms > SLOW_GET_MS) {
        recordDiagnostic('http_request', { route, method, path, status: response.status, ms });
      }
      return response;
    } catch (error: any) {
      recordDiagnostic('http_request', {
        route,
        method,
        path,
        error: String(error?.message ?? error).slice(0, 120),
        ms: Date.now() - startedAt,
      });
      throw error;
    }
  };
}
