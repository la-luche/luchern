import { recordDiagnostic } from './diagnostics';
import { isConnectionFailure } from './connectivity';
import { recoverConnection } from './networkRecovery';

/** Record slow/failed reads and writes without credentials or query strings. */
const SLOW_GET_MS = 10_000;

const ROUTE_BY_HOST: Record<string, string> = {
  'luche.ai': 'app',
};

let installed = false;

export function installRequestLog(): void {
  if (installed) return;
  installed = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: any, init?: any) => {
    let host = '';
    let path = '';
    let requestUrl = '';
    try {
      const url = new URL(typeof input === 'string' ? input : (input?.url ?? String(input)));
      host = url.hostname;
      path = url.pathname;
      requestUrl = url.href;
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
      const signal = init?.signal ?? (typeof input === 'object' ? input?.signal : undefined);
      // A caller cancellation is not a failed connection. Our own request
      // deadlines report recovery explicitly from transport.ts.
      if (!signal?.aborted && error?.name !== 'AbortError' && isConnectionFailure(error)) {
        await recoverConnection(requestUrl);
      }
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
