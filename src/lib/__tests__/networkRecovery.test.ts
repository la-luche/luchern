jest.mock('../../../modules/network-recovery', () => ({
  __esModule: true,
  default: { activate: jest.fn().mockResolvedValue(true) },
}));
jest.mock('../diagnostics', () => ({ recordDiagnostic: jest.fn(), diagnosticErrorData: () => ({}) }));

const originalFetch = globalThis.fetch;
let activate: jest.Mock;
let recover: typeof import('../networkRecovery').recoverConnection;

beforeEach(() => {
  jest.resetModules();
  activate = require('../../../modules/network-recovery').default.activate;
  recover = require('../networkRecovery').recoverConnection;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

test('restricts recovery to HTTPS Luche hosts and coalesces parallel failures', async () => {
  for (const url of ['file:///recording.mp4', 'https://other.example', 'http://luche.ai', 'https://luche.ai.evil.example']) {
    expect(await recover(url)).toBe(false);
  }
  expect(activate).not.toHaveBeenCalled();
  let finish!: (value: boolean) => void;
  activate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = recover('https://luche.ai/api/me');
  const second = recover('https://luche.ai/__clerk/v1/client?secret=never-forwarded');
  expect(activate).toHaveBeenCalledTimes(1);
  expect(activate).toHaveBeenCalledWith('luche.ai');
  finish(true);
  expect(await first).toBe(true);
  expect(await second).toBe(true);
});

test('fetch leaves successful requests and HTTP rejections on ordinary DNS', async () => {
  const fetchMock = jest.fn().mockResolvedValueOnce({ status: 200, ok: true })
    .mockResolvedValueOnce({ status: 403, ok: false });
  globalThis.fetch = fetchMock;
  require('../requestLog').installRequestLog();
  await fetch('https://luche.ai/api/me');
  await fetch('https://luche.ai/__clerk/v1/client');
  expect(activate).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('a failed auth POST enables recovery without replaying the write', async () => {
  const error = new TypeError('Network request failed');
  const fetchMock = jest.fn().mockRejectedValue(error);
  globalThis.fetch = fetchMock;
  require('../requestLog').installRequestLog();
  await expect(fetch('https://luche.ai/__clerk/v1/sign_ins', { method: 'POST', body: '{}' })).rejects.toBe(error);
  expect(activate).toHaveBeenCalledWith('luche.ai');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('explicit cancellation does not change resolver', async () => {
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  require('../requestLog').installRequestLog();
  await expect(fetch('https://luche.ai/api/me', { signal: controller.signal })).rejects.toThrow();
  expect(activate).not.toHaveBeenCalled();
});

test('safe API read retries the same URL after activating recovery', async () => {
  const events: string[] = [];
  activate.mockImplementation(async () => { events.push('recover'); return true; });
  globalThis.fetch = jest.fn()
    .mockImplementationOnce(async () => { events.push('normal'); throw new TypeError('Network request failed'); })
    .mockImplementationOnce(async () => { events.push('retry'); return { ok: true, status: 200 }; });
  const { fetchWithTransport } = require('../transport');
  const result = await fetchWithTransport('/health', 'test', {});
  result.release();
  expect(events).toEqual(['normal', 'recover', 'retry']);
  expect((globalThis.fetch as jest.Mock).mock.calls.map(([url]) => url))
    .toEqual(['https://luche.ai/api/health', 'https://luche.ai/api/health']);
});

test('a native recovery error preserves the original fetch error', async () => {
  activate.mockRejectedValue(new Error('native unavailable'));
  expect(await recover('https://luche.ai/api/me')).toBe(false);
});

test('Android startup plugin installs before React Native and is idempotent', () => {
  const { installRecovery } = require('../../../plugins/with-network-recovery');
  const source = 'override fun onCreate() {\n    super.onCreate()\n    loadReactNative(this)\n  }';
  const changed = installRecovery(source);
  expect(changed.indexOf('NetworkRecovery.install(this)')).toBeLessThan(changed.indexOf('super.onCreate()'));
  expect(installRecovery(changed)).toBe(changed);
  expect(() => installRecovery('unexpected template')).toThrow();
});
