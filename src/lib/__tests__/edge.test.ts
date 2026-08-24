jest.mock('../diagnostics', () => ({ recordDiagnostic: jest.fn() }));

import {
  PRIMARY_API_BASE,
  RUSSIAN_API_BASE,
  RUSSIAN_CLERK_PROXY,
  apiBaseOrder,
  registerClerkTransportFallback,
  requestClerkTransportFallback,
  resetPreferredApiBase,
  selectClerkProxyUrl,
} from '../edge';

describe('edge selection', () => {
  beforeEach(async () => {
    resetPreferredApiBase();
    globalThis.fetch = jest.fn();
    await jest
      .requireMock('@react-native-async-storage/async-storage')
      .clear();
  });

  it('keeps Clerk and API direct when the canonical Frontend API works', async () => {
    (globalThis.fetch as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({ ok: url.includes('clerk.luche.ai'), text: async () => '{}' }),
    );

    await expect(selectClerkProxyUrl()).resolves.toBeUndefined();
    expect(apiBaseOrder()[0]).toBe(PRIMARY_API_BASE);
    // Both probes run in parallel; direct's success wins regardless of timing.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('selects the Russian same-instance proxy when direct Clerk is blocked', async () => {
    (globalThis.fetch as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({ ok: url.includes('xn--e1alyq.xn--p1ai'), text: async () => '{}' }),
    );

    await expect(selectClerkProxyUrl()).resolves.toBe(RUSSIAN_CLERK_PROXY);
    expect(apiBaseOrder()[0]).toBe(RUSSIAN_API_BASE);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('clerk.luche.ai'),
      expect.any(Object),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('xn--e1alyq.xn--p1ai'),
      expect.any(Object),
    );
  });

  it('selects Russian before mounting Clerk when direct is too slow', async () => {
    jest.useFakeTimers();
    (globalThis.fetch as jest.Mock)
      .mockImplementationOnce((_url, { signal }: RequestInit) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }))
      .mockResolvedValueOnce({ ok: true, text: async () => '{}' });

    const selected = selectClerkProxyUrl();
    await jest.advanceTimersByTimeAsync(5000);

    await expect(selected).resolves.toBe(RUSSIAN_CLERK_PROXY);
    expect(apiBaseOrder()[0]).toBe(RUSSIAN_API_BASE);
    jest.useRealTimers();
  });

  it('stays on the canonical route when both health checks are inconclusive', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('blocked'));

    await expect(selectClerkProxyUrl()).resolves.toBeUndefined();
    expect(apiBaseOrder()[0]).toBe(PRIMARY_API_BASE);
  });

  it('honors a persisted ru-edge verdict over a passing direct probe', async () => {
    const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem('luche.clerkTransport.v1', 'ru-edge');
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '{}' });

    await expect(selectClerkProxyUrl()).resolves.toBe(RUSSIAN_CLERK_PROXY);
    expect(apiBaseOrder()[0]).toBe(RUSSIAN_API_BASE);
    await AsyncStorage.removeItem('luche.clerkTransport.v1');
  });

  it('ignores a persisted ru-edge verdict when the edge probe fails', async () => {
    const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem('luche.clerkTransport.v1', 'ru-edge');
    (globalThis.fetch as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({ ok: url.includes('clerk.luche.ai'), text: async () => '{}' }),
    );

    await expect(selectClerkProxyUrl()).resolves.toBeUndefined();
    expect(apiBaseOrder()[0]).toBe(PRIMARY_API_BASE);
    await AsyncStorage.removeItem('luche.clerkTransport.v1');
  });

  it('converges across launches: runtime verdict outlives deceptive probe wins', async () => {
    const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage');
    const { persistClerkTransport } = jest.requireActual('../edge');
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '{}' });

    // Launch 1: no verdict, direct probe passes (deceptively on RU) → direct.
    await expect(selectClerkProxyUrl()).resolves.toBeUndefined();
    await expect(AsyncStorage.getItem('luche.clerkTransport.v1')).resolves.toBe('direct');

    // Runtime proof: bootstrap hung, the watchdog demoted the session.
    persistClerkTransport('ru-edge');

    // Launch 2: verdict honored over the passing direct probe...
    await expect(selectClerkProxyUrl()).resolves.toBe(RUSSIAN_CLERK_PROXY);
    // ...and the probe win must NOT have erased the runtime verdict.
    await expect(AsyncStorage.getItem('luche.clerkTransport.v1')).resolves.toBe('ru-edge');

    // Launch 3: identical — stable, no oscillation.
    await expect(selectClerkProxyUrl()).resolves.toBe(RUSSIAN_CLERK_PROXY);
  });

  it('lets token refresh request a ClerkProvider transport switch', () => {
    const fallback = jest.fn(() => true);
    const unregister = registerClerkTransportFallback(fallback);

    expect(requestClerkTransportFallback()).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(1);

    unregister();
    expect(requestClerkTransportFallback()).toBe(false);
  });
});
