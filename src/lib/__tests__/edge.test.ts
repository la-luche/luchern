import {
  PRIMARY_API_BASE,
  RUSSIAN_API_BASE,
  RUSSIAN_CLERK_PROXY,
  apiBaseOrder,
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
  });

  it('selects the Russian same-instance proxy when direct Clerk is blocked', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({ ok: url.includes('xn--e1alyq.xn--p1ai') }),
    );

    await expect(selectClerkProxyUrl()).resolves.toBe(RUSSIAN_CLERK_PROXY);
    expect(apiBaseOrder()[0]).toBe(RUSSIAN_API_BASE);
  });
});
