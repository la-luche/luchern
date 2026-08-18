import { getNetworkStateAsync } from 'expo-network';

import { diagnosticErrorData, recordDiagnostic } from './diagnostics';
import {
  PRIMARY_API_BASE,
  RUSSIAN_API_BASE,
  apiBaseLabel,
  apiBaseOrder,
  preferApiBase,
} from './edge';

/**
 * Shared transport policy for every JSON API request.
 *
 * Safe reads always get one attempt on each base, preferred first — no route
 * is ever a dead end. The base that answers becomes the preferred base for
 * subsequent requests (reads and writes alike). Writes are never repeated
 * after an ambiguous transport failure, but a failed write flips the
 * preference so its next explicit retry tries the other base.
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

/** Attach the device's network state to the event when it can be read fast;
 * a support log line must never wait on (or fail with) the state lookup. */
function recordNetworkErrorDiagnostic(
  data: Record<string, string | number | boolean>,
): void {
  void Promise.race([
    getNetworkStateAsync(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
  ])
    .catch(() => null)
    .then((state) => {
      recordDiagnostic('api_network_error', {
        ...data,
        ...(state
          ? {
              networkType: String(state.type ?? 'unknown'),
              internetReachable: state.isInternetReachable ?? null,
            }
          : {}),
      });
    });
}

function attemptOrder(method: string): string[] {
  const [preferred, fallback] = apiBaseOrder();
  if (!SAFE_REPEAT_METHODS.has(method)) return [preferred];
  // Third slot restores the fresh-connection retry the Russian edge needs
  // (it closes every response/socket, so a first attempt on a reused socket
  // can fail spuriously) — and gives the preferred base the same courtesy
  // when the other base is blocked outright.
  return [preferred, fallback, preferred];
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
      } else {
        // A write cannot be replayed safely, but its next explicit user retry
        // should try the other base instead of repeating the one that failed.
        preferApiBase(endpoint === PRIMARY_API_BASE ? RUSSIAN_API_BASE : PRIMARY_API_BASE);
      }

      recordNetworkErrorDiagnostic({
        requestId: reqId,
        method,
        path,
        endpoint: apiBaseLabel(endpoint),
        attempt: index + 1,
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
