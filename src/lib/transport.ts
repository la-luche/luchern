import { diagnosticErrorData, recordDiagnostic } from './diagnostics';
import {
  PRIMARY_API_BASE,
  RUSSIAN_API_BASE,
  apiBaseOrder,
  preferApiBase,
} from './edge';

/**
 * Shared transport policy for every JSON API request.
 *
 * Safe reads may move from the direct API to the Russian edge. Once the
 * Russian route has been selected, a failed read retries that same route on a
 * fresh connection instead of bouncing back to a route already known to be
 * blocked. Writes are never repeated after an ambiguous transport failure.
 */
export const REQUEST_TIMEOUT_MS = 8_000;

const SAFE_REPEAT_METHODS = new Set(['GET', 'HEAD']);
const RETRYABLE_GATEWAY_STATUSES = new Set([502, 503, 504]);

export class ApiNetworkError extends Error {
  constructor(
    public readonly path: string,
    public readonly requestId: string,
    cause: unknown,
    public readonly endpoint?: string,
  ) {
    super('network request failed', { cause });
    this.name = 'ApiNetworkError';
  }
}

export class ApiTimeoutError extends Error {
  constructor(
    public readonly path: string,
    public readonly requestId: string,
    public readonly endpoint: string,
  ) {
    super('network request timed out');
    this.name = 'ApiTimeoutError';
  }
}

function attemptOrder(method: string): string[] {
  const [preferred, fallback] = apiBaseOrder();
  if (!SAFE_REPEAT_METHODS.has(method)) return [preferred];

  // Direct gets one chance before the known-good Russian fallback. On the
  // Russian route, retry once there; the edge closes every response/socket.
  if (preferred === RUSSIAN_API_BASE) return [preferred, preferred];
  return [preferred, fallback];
}

export async function fetchWithTransport(
  path: string,
  reqId: string,
  init: RequestInit,
): Promise<{ response: Response; endpoint: string }> {
  const method = (init.method ?? 'GET').toUpperCase();
  const endpoints = attemptOrder(method);
  let lastError: ApiNetworkError | ApiTimeoutError | undefined;

  for (const [index, endpoint] of endpoints.entries()) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (init.signal?.aborted) controller.abort();
    else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${endpoint}${path}`, { ...init, signal: controller.signal });
      const hasNextAttempt = index < endpoints.length - 1;
      if (RETRYABLE_GATEWAY_STATUSES.has(response.status) && hasNextAttempt) {
        preferApiBase(endpoints[index + 1]);
        continue;
      }
      preferApiBase(endpoint);
      return { response, endpoint };
    } catch (error) {
      if (init.signal?.aborted) throw error;
      const wrapped = timedOut
        ? new ApiTimeoutError(path, reqId, endpoint)
        : new ApiNetworkError(path, reqId, error, endpoint);
      lastError = wrapped;
      const hasNextAttempt = index < endpoints.length - 1;

      if (hasNextAttempt) {
        preferApiBase(endpoints[index + 1]);
      } else if (endpoint === PRIMARY_API_BASE) {
        // A write cannot be replayed safely, but its next explicit user retry
        // should use the fallback instead of repeating the failed direct path.
        preferApiBase(RUSSIAN_API_BASE);
      }

      recordDiagnostic('api_network_error', {
        requestId: reqId,
        method,
        path,
        endpoint,
        timedOut,
        retryScheduled: hasNextAttempt,
        ...diagnosticErrorData(wrapped),
      });
      if (!hasNextAttempt) throw wrapped;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw lastError ?? new ApiNetworkError(path, reqId, null);
}
