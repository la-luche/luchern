/**
 * Network-condition matrix: RU networks can block, throttle, or PARTIALLY
 * serve any subset of requests — headers without body, HTTP-status block
 * pages, connection resets mid-body. This suite enumerates combinations of
 * route behaviors and asserts the transport invariant: if any usable
 * configuration exists, a request converges to it within one apiFetch call
 * plus one caller retry — no combination is a permanent dead end, and
 * nothing hangs forever.
 */
jest.mock('@clerk/clerk-expo', () => ({ getClerkInstance: jest.fn() }));
jest.mock('../diagnostics', () => ({
  diagnosticErrorData: (error: Error) => ({ error: error.name, message: error.message }),
  recordDiagnostic: jest.fn(),
}));

import { getClerkInstance } from '@clerk/clerk-expo';

import { API_BASE, ApiError, FALLBACK_API_BASE, apiFetch } from '../api';
import {
  PRIMARY_API_BASE,
  RUSSIAN_CLERK_PROXY,
  RUSSIAN_EDGE_ORIGIN,
  apiBaseOrder,
  resetPreferredApiBase,
  selectClerkProxyUrl,
} from '../edge';
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
// The probe now downloads the body, so a stalled or reset body FAILS it —
// only a block page (fast, complete HTML body) still deceives it.
const probePasses = (s: RouteState) => usable(s) || s === 'blockPage200';

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

function installFetch(primary: RouteState, edge: RouteState): void {
  global.fetch = jest.fn((url: string, init?: RequestInit) => {
    const isEdge = String(url).startsWith(RUSSIAN_EDGE_ORIGIN);
    return respond(isEdge ? edge : primary, init?.signal ?? undefined);
  }) as unknown as typeof fetch;
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
    resetPreferredApiBase();
    (getClerkInstance as jest.Mock).mockReturnValue({
      session: { getToken: jest.fn().mockResolvedValue('token') },
    });
    await jest.requireMock('@react-native-async-storage/async-storage').clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('apiFetch GET converges whenever any route is usable', () => {
    const combos = STATES.flatMap((p) => STATES.map((e) => [p, e] as const));

    it.each(combos)('primary=%s edge=%s', async (primary, edge) => {
      installFetch(primary, edge);

      const anyUsable = usable(primary) || usable(edge);
      const first = await settle(apiFetch('/ping'));

      if (first.ok) {
        expect(anyUsable).toBe(true);
        return;
      }
      expect(isTransportFailure(first.error)).toBe(true);
      // First call may fail while probing a compromised route (e.g. a
      // stalled body is only discovered after headers). The invariant is
      // that failure demoted the bad route, so the caller's single retry
      // succeeds whenever anything usable exists.
      const second = await settle(apiFetch('/ping'));
      expect(second.ok).toBe(anyUsable);
      if (!second.ok) expect(isTransportFailure(second.error)).toBe(true);
    });
  });

  describe('clerk probe selection never hangs; direct has priority when it answers', () => {
    const combos = STATES.flatMap((p) => STATES.map((e) => [p, e] as const));

    it.each(combos)('direct=%s edge=%s', async (direct, edge) => {
      installFetch(direct, edge);

      const selection = selectClerkProxyUrl();
      const outcome = selection.then((value) => value);
      await jest.advanceTimersByTimeAsync(20_000);
      const proxyUrl = await outcome;

      if (probePasses(direct)) {
        // Direct priority: whenever direct answers its probe, direct wins —
        // a fast edge answer must never steal the launch (the historical
        // "US users exiled to the edge" bug).
        expect(proxyUrl).toBeUndefined();
        expect(apiBaseOrder()[0]).toBe(PRIMARY_API_BASE);
      } else if (probePasses(edge)) {
        expect(proxyUrl).toBe(RUSSIAN_CLERK_PROXY);
      } else {
        // Nothing answered and no stored verdict: canonical direct default.
        expect(proxyUrl).toBeUndefined();
        expect(apiBaseOrder()[0]).toBe(PRIMARY_API_BASE);
      }
    });
  });

  it('a stalled-body primary demotes itself so the retry uses the edge', async () => {
    installFetch('stalledBody', 'healthy');

    const first = await settle(apiFetch('/ping'));
    expect(first.ok).toBe(false);

    const calls = (global.fetch as jest.Mock).mock.calls.length;
    const second = await settle(apiFetch('/ping'));
    expect(second.ok).toBe(true);
    // Retry went straight to the edge (demoted preference), not primary.
    const retryUrl = (global.fetch as jest.Mock).mock.calls[calls][0] as string;
    expect(retryUrl.startsWith(FALLBACK_API_BASE)).toBe(true);
  });

  it('a 403-serving middlebox on primary is not a dead end for reads', async () => {
    installFetch('http403', 'healthy');

    const result = await settle(apiFetch('/ping'));
    expect(result.ok).toBe(true);
    const urls = (global.fetch as jest.Mock).mock.calls.map(([u]) => u as string);
    expect(urls[0]).toBe(`${API_BASE}/ping`);
    expect(urls[1].startsWith(FALLBACK_API_BASE)).toBe(true);
  });

  it('a captive-portal 200 block page on primary converges to the edge', async () => {
    installFetch('blockPage200', 'healthy');

    // Headers say 200, body is HTML: first call fails on parse and demotes.
    const first = await settle(apiFetch('/ping'));
    expect(first.ok).toBe(false);
    const second = await settle(apiFetch('/ping'));
    expect(second.ok).toBe(true);
  });

  it('slow routes inside the window are served, not flipped away from', async () => {
    installFetch('slow', 'refused');

    const result = await settle(apiFetch('/ping'));
    expect(result.ok).toBe(true);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(`${PRIMARY_API_BASE}/ping`);
  });
});
