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
  beforeEach(() => {
    resetPreferredApiBase();
    global.fetch = jest.fn();
  });

  it('keeps Clerk and API direct when the canonical Frontend API works', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({ ok: url.includes('clerk.luche.ai') }),
    );

    await expect(selectClerkProxyUrl()).resolves.toBeUndefined();
    expect(apiBaseOrder()[0]).toBe(PRIMARY_API_BASE);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('selects the Russian same-instance proxy when direct Clerk is blocked', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({ ok: url.includes('xn--e1alyq.xn--p1ai') }),
    );

    await expect(selectClerkProxyUrl()).resolves.toBe(RUSSIAN_CLERK_PROXY);
    expect(apiBaseOrder()[0]).toBe(RUSSIAN_API_BASE);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('clerk.luche.ai'),
      expect.any(Object),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('xn--e1alyq.xn--p1ai'),
      expect.any(Object),
    );
  });

  it('selects Russian before mounting Clerk when direct is too slow', async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock)
      .mockImplementationOnce((_url, { signal }: RequestInit) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }))
      .mockResolvedValueOnce({ ok: true });

    const selected = selectClerkProxyUrl();
    await jest.advanceTimersByTimeAsync(400);

    await expect(selected).resolves.toBe(RUSSIAN_CLERK_PROXY);
    expect(apiBaseOrder()[0]).toBe(RUSSIAN_API_BASE);
    jest.useRealTimers();
  });

  it('uses the Russian fallback when both health checks are inconclusive', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('blocked'));

    await expect(selectClerkProxyUrl()).resolves.toBe(RUSSIAN_CLERK_PROXY);
    expect(apiBaseOrder()[0]).toBe(RUSSIAN_API_BASE);
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
