import path from 'node:path';

const clerkExpoEntry = require.resolve('@clerk/clerk-expo');
const createClerkInstancePath = path.join(
  path.dirname(clerkExpoEntry),
  'provider/singleton/createClerkInstance.js',
);
const clerkHeadlessPath = require.resolve('@clerk/clerk-js/headless', {
  paths: [path.dirname(createClerkInstancePath)],
});
const clerkSharedErrorPath = require.resolve('@clerk/shared/error', {
  paths: [path.dirname(createClerkInstancePath)],
});
jest.doMock(clerkHeadlessPath, () => ({ isClerkRuntimeError: jest.fn(() => false) }));
jest.doMock(clerkSharedErrorPath, () => ({
  ...jest.requireActual(clerkSharedErrorPath),
  is4xxError: jest.fn(() => false),
}));
const { createClerkInstance } = require(createClerkInstancePath);

const EDGE = 'https://xn--e1alyq.xn--p1ai/__clerk';
const DIRECT_REQUEST =
  'https://clerk.luche.ai/v1/client/sign_ins?__clerk_api_version=2025-11-10';

class FakeClerk {
  publishableKey: string;
  beforeRequest?: (request: any) => Promise<void>;
  afterResponse?: (request: any, response: any) => Promise<void>;

  constructor(publishableKey: string) {
    this.publishableKey = publishableKey;
  }

  __unstable__onBeforeRequest(callback: (request: any) => Promise<void>) {
    this.beforeRequest = callback;
  }

  __unstable__onAfterResponse(callback: (request: any, response: any) => Promise<void>) {
    this.afterResponse = callback;
  }
}

describe('@clerk/clerk-expo native proxy patch', () => {
  it('recreates Clerk when proxyUrl changes and rewrites FAPI requests through it', async () => {
    const getClerkInstance = createClerkInstance(FakeClerk);
    const tokenCache = {
      getToken: jest.fn().mockResolvedValue(null),
      saveToken: jest.fn().mockResolvedValue(undefined),
      clearToken: jest.fn().mockResolvedValue(undefined),
    };
    const publishableKey = 'pk_test_luche_proxy_regression';

    const direct = getClerkInstance({ publishableKey, tokenCache });
    const proxied = getClerkInstance({ publishableKey, proxyUrl: EDGE, tokenCache });

    expect(proxied).not.toBe(direct);
    expect(proxied.beforeRequest).toBeDefined();

    const request = {
      url: new URL(DIRECT_REQUEST),
      headers: { set: jest.fn() },
    };
    await proxied.beforeRequest!(request);

    expect(request.url.origin).toBe('https://xn--e1alyq.xn--p1ai');
    expect(request.url.pathname).toBe('/__clerk/v1/client/sign_ins');
    expect(request.url.searchParams.get('__clerk_api_version')).toBe('2025-11-10');
    expect(request.url.searchParams.get('_is_native')).toBe('1');
  });
});
