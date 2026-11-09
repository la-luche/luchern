/** Bounded behavior on complete, partial, stalled and rejected connections. */
jest.mock('@clerk/clerk-expo', () => ({ getClerkInstance: jest.fn() }));
jest.mock('../diagnostics', () => ({
  diagnosticErrorData: (error: Error) => ({ error: error.name, message: error.message }),
  recordDiagnostic: jest.fn(),
}));

import { getClerkInstance } from '@clerk/clerk-expo';

import { API_BASE, ApiError, apiFetch } from '../api';

import { ApiNetworkError, ApiTimeoutError } from '../transport';

type RouteState =
  | 'healthy'
  | 'slow'
  | 'refused'
  | 'blackhole'
  | 'stalledBody'
  | 'resetBody'
  | 'http403'
  | 'blockPage200';
const STATES: RouteState[] = [
  'healthy', 'slow', 'refused', 'blackhole',
  'stalledBody', 'resetBody', 'http403', 'blockPage200',
];

// A route serves a complete, valid response only in these states.
const usable = (s: RouteState) => s === 'healthy' || s === 'slow';
function stalledBodyRead(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new TypeError('Network request failed'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function response(
  kind: 'ok' | 'stalledBody' | 'resetBody' | 'blockPage200' | 'http403',
  signal?: AbortSignal,
): Response {
  const base = { ok: true, status: 200 };
  switch (kind) {
    case 'ok':
      return {
        ...base,
        json: jest.fn().mockResolvedValue({ pong: true }),
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;
    case 'stalledBody':
      // Real RN fetch rejects an in-flight body read when the request's
      // AbortController fires — the stalled body must honor that, or the
      // mock models a hang no real network can produce.
      return {
        ...base,
        json: () => stalledBodyRead(signal),
        text: () => stalledBodyRead(signal),
      } as unknown as Response;
    case 'resetBody':
      return {
        ...base,
        json: jest.fn().mockRejectedValue(new TypeError('Network request failed')),
        text: jest.fn().mockRejectedValue(new TypeError('Network request failed')),
      } as unknown as Response;
    case 'blockPage200':
      return {
        ...base,
        json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
        text: jest.fn().mockResolvedValue('<html>доступ ограничен</html>'),
      } as unknown as Response;
    case 'http403':
      return {
        ok: false,
        status: 403,
        json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
        text: jest.fn().mockResolvedValue('<html>blocked</html>'),
      } as unknown as Response;
  }
}

function respond(state: RouteState, signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new TypeError('Network request failed'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    switch (state) {
      case 'healthy':
        resolve(response('ok'));
        break;
      case 'slow':
        setTimeout(() => resolve(response('ok')), 4_000);
        break;
      case 'refused':
        reject(new TypeError('Network request failed'));
        break;
      case 'blackhole':
        break; // only the abort listener ever settles this
      default:
        resolve(response(state, signal));
    }
  });
}

function installFetch(state: RouteState): void {
  globalThis.fetch = jest.fn((_url: string, init?: RequestInit) =>
    respond(state, init?.signal ?? undefined)) as unknown as typeof fetch;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Drain fake timers and demand the promise settled — a hang is a named failure. */
async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  const outcome: Promise<Settled<T>> = p.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  // Two transport passes worst-case: 3 attempts x 8s + body reads + retries.
  await jest.advanceTimersByTimeAsync(120_000);
  await Promise.resolve();
  const raced = await Promise.race([outcome, Promise.resolve('HUNG' as const)]);
  expect(raced).not.toBe('HUNG');
  return raced as Settled<T>;
}

const isTransportFailure = (e: unknown) =>
  e instanceof ApiNetworkError || e instanceof ApiTimeoutError || e instanceof ApiError;

describe('network-condition matrix', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    (getClerkInstance as jest.Mock).mockReturnValue({
      session: { getToken: jest.fn().mockResolvedValue('token') },
    });
    await jest.requireMock('@react-native-async-storage/async-storage').clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(STATES)('GET finishes or reports a bounded error: %s', async (state) => {
    installFetch(state);
    const result = await settle(apiFetch('/ping'));
    expect(result.ok).toBe(usable(state));
    if (!result.ok) expect(isTransportFailure(result.error)).toBe(true);
    expect((globalThis.fetch as jest.Mock).mock.calls.length).toBeLessThanOrEqual(3);
    expect((globalThis.fetch as jest.Mock).mock.calls.every(([url]) => url === `${API_BASE}/ping`)).toBe(true);
  });

  it.each(STATES)('POST is never repeated after an ambiguous outcome: %s', async (state) => {
    installFetch(state);
    const result = await settle(apiFetch('/trials', { method: 'POST' }));
    expect(result.ok).toBe(usable(state));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('honors caller cancellation without starting another request', async () => {
    installFetch('blackhole');
    const controller = new AbortController();
    const pending = apiFetch('/ping', { signal: controller.signal });
    const outcome = pending.catch(error => error);
    for (let turn = 0; turn < 20 && !(globalThis.fetch as jest.Mock).mock.calls.length; turn += 1) {
      await Promise.resolve();
    }
    controller.abort();
    await settle(outcome);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
