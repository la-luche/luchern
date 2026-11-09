import { clearWorkTimeout, setWorkTimeout } from './workTimers';
import { getNetworkStateAsync } from 'expo-network';

import { diagnosticErrorData, recordDiagnostic } from './diagnostics';
import { PRIMARY_API_BASE, apiBaseLabel } from './edge';
import { recoverConnection } from './networkRecovery';
import { isConnectionFailure } from './connectivity';

/** Bounded retries on the same URL. Ambiguous writes are never replayed. */
export const REQUEST_TIMEOUT_MS = 8_000;

const SAFE_REPEAT_METHODS = new Set(['GET', 'HEAD']);

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
    new Promise<null>((resolve) => setWorkTimeout(() => resolve(null), 500)),
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
  return Array(SAFE_REPEAT_METHODS.has(method) ? 3 : 1).fill(PRIMARY_API_BASE);
}

export async function fetchWithTransport(
  path: string,
  reqId: string,
  init: RequestInit,
): Promise<{ response: Response; endpoint: string; release: () => void }> {
  const method = (init.method ?? 'GET').toUpperCase();
  const endpoints = attemptOrder(method);
  let lastError: ApiNetworkError | ApiTimeoutError | undefined;

  for (const [index, endpoint] of endpoints.entries()) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (init.signal?.aborted) controller.abort();
    else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setWorkTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    let handedOff = false;
    const release = () => {
      clearWorkTimeout(timer);
      init.signal?.removeEventListener('abort', abortFromCaller);
    };

    try {
      const response = await fetch(`${endpoint}${path}`, { ...init, signal: controller.signal });
      const hasNextAttempt = index < endpoints.length - 1;
      if (response.ok) {
        handedOff = true;
        return { response, endpoint, release };
      }
      // Retry transient server errors on safe reads. Authorization and other
      // client errors are returned immediately to the caller.
      const transient = response.status === 408 || response.status === 429 || response.status >= 500;
      if (transient && hasNextAttempt && SAFE_REPEAT_METHODS.has(method)) {
        // No caller will consume this response body. Abort the native request
        // before retrying so a stalled/error body cannot retain
        // a socket for every queued recording.
        controller.abort();
        continue;
      }
      handedOff = true;
      return { response, endpoint, release };
    } catch (error) {
      if (init.signal?.aborted) throw error;
      clearWorkTimeout(timer);
      if (timedOut || isConnectionFailure(error)) await recoverConnection(endpoint);
      if (init.signal?.aborted) throw error;
      const wrapped = timedOut
        ? new ApiTimeoutError(path, reqId, endpoint)
        : new ApiNetworkError(path, reqId, error, endpoint);
      lastError = wrapped;
      const hasNextAttempt = index < endpoints.length - 1;

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
      if (!handedOff) release();
    }
  }

  throw lastError ?? new ApiNetworkError(path, reqId, null);
}
