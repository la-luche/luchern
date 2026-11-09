jest.mock('@clerk/clerk-expo', () => ({ getClerkInstance: jest.fn() }));
jest.mock('../diagnostics', () => ({
  diagnosticErrorData: (error: Error) => ({ error: error.name, message: error.message }),
  recordDiagnostic: jest.fn(),
}));

import { getClerkInstance } from '@clerk/clerk-expo';

import {
  API_BASE,
  ApiError,
  ApiNetworkError,
  apiFetch,
} from '../api';
import { REQUEST_TIMEOUT_MS } from '../transport';


function response({
  ok = true,
  status = 200,
  json = {},
  text = '',
}: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
} = {}): Response {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(json),
    text: jest.fn().mockResolvedValue(text),
  } as unknown as Response;
}

describe('mobile API transport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getClerkInstance as jest.Mock).mockReturnValue({
      session: { getToken: jest.fn().mockResolvedValue('token') },
    });
    globalThis.fetch = jest.fn();
  });

  afterEach(() => jest.useRealTimers());

  it('uses the canonical Pi backend', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(response({ json: { patients: [] } }));

    await apiFetch('/patients');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_BASE}/patients`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });

  it('retries a safe read at the same canonical URL', async () => {
    (globalThis.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(response({ json: { patients: [] } }));

    await apiFetch('/patients');

    expect((globalThis.fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
      `${API_BASE}/patients`,
      `${API_BASE}/patients`,
    ]);
  });

  it('reports exhausted token refresh without sending an unauthenticated API request', async () => {
    const getToken = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    (getClerkInstance as jest.Mock).mockReturnValue({ session: { getToken } });
    await expect(apiFetch('/trials/299')).rejects.toBeInstanceOf(ApiNetworkError);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('retries one failed Clerk token refresh before surfacing an error', async () => {
    const getToken = jest.fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce('fresh-token');
    (getClerkInstance as jest.Mock).mockReturnValue({ session: { getToken } });
    (globalThis.fetch as jest.Mock).mockResolvedValue(response({ json: { patients: [] } }));

    await apiFetch('/patients');

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken.mock.calls).toEqual([[undefined], [{ skipCache: true }]]);
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/patients'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      }),
    );
  });

  it('deduplicates simultaneous Clerk token refreshes', async () => {
    let resolveToken!: (token: string) => void;
    const pendingToken = new Promise<string>((resolve) => { resolveToken = resolve; });
    const getToken = jest.fn().mockReturnValue(pendingToken);
    (getClerkInstance as jest.Mock).mockReturnValue({ session: { getToken } });
    (globalThis.fetch as jest.Mock).mockResolvedValue(response({ json: {} }));

    const requests = Promise.all([apiFetch('/patients'), apiFetch('/me/trials')]);
    resolveToken('shared-token');
    await requests;

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes the token and repeats a request after an explicit 401', async () => {
    const getToken = jest.fn()
      .mockResolvedValueOnce('expired-token')
      .mockResolvedValueOnce('fresh-token');
    (getClerkInstance as jest.Mock).mockReturnValue({ session: { getToken } });
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce(response({ ok: false, status: 401 }))
      .mockResolvedValueOnce(response({ json: { patients: [] } }));

    await apiFetch('/patients');

    expect(getToken).toHaveBeenCalledTimes(2);
    expect((globalThis.fetch as jest.Mock).mock.calls[1][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      }),
    );
  });

  it('does not repeat an authenticated write under a different Clerk account', async () => {
    const sessionA = {
      user: { id: 'user-a' },
      getToken: jest.fn().mockResolvedValue('token-a'),
    };
    const sessionB = {
      user: { id: 'user-b' },
      getToken: jest.fn().mockResolvedValue('token-b'),
    };
    (getClerkInstance as jest.Mock).mockReturnValue({ session: sessionA });
    (globalThis.fetch as jest.Mock).mockImplementationOnce(async () => {
      (getClerkInstance as jest.Mock).mockReturnValue({ session: sessionB });
      return response({ ok: false, status: 401 });
    });

    await expect(apiFetch('/guests', { method: 'POST' })).rejects.toThrow(
      'signed-in account changed',
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(sessionB.getToken).not.toHaveBeenCalled();
  });

  it('aborts the native request when a successful response body stalls', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    (globalThis.fetch as jest.Mock).mockImplementation(
      async (_url: string, init: RequestInit) => {
        requestSignal = init.signal ?? undefined;
        return {
          ok: true,
          status: 200,
          json: () => new Promise((_resolve, reject) => {
            requestSignal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
          text: jest.fn(),
        } as unknown as Response;
      },
    );

    const pending = apiFetch('/patients');
    const rejection = expect(pending).rejects.toBeInstanceOf(ApiNetworkError);
    for (let turn = 0; turn < 10 && !requestSignal; turn += 1) {
      await Promise.resolve();
    }
    expect(requestSignal).toBeDefined();
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
    jest.useRealTimers();
  });

  it('rejects delayed work whose originating account is no longer signed in', async () => {
    const sessionB = {
      user: { id: 'user-b' },
      getToken: jest.fn().mockResolvedValue('token-b'),
    };
    (getClerkInstance as jest.Mock).mockReturnValue({ session: sessionB });

    await expect(
      apiFetch('/uploads/request-url', { method: 'POST' }, 'user-a'),
    ).rejects.toThrow('signed-in account changed');

    expect(sessionB.getToken).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not replay an ambiguous POST; an explicit retry uses the same URL', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(apiFetch('/invites', { method: 'POST' })).rejects.toBeInstanceOf(
      ApiNetworkError,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(response({ json: { token: '1234' } }));
    await apiFetch('/invites', { method: 'POST' });
    expect((globalThis.fetch as jest.Mock).mock.calls[1][0]).toBe(`${API_BASE}/invites`);
  });

  it('retries transient server errors on a safe read', async () => {
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce(response({ ok: false, status: 503 }))
      .mockResolvedValueOnce(response({ json: { patients: [] } }));
    await apiFetch('/patients');
    expect((globalThis.fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
      `${API_BASE}/patients`, `${API_BASE}/patients`,
    ]);
  });

  it('returns a permission error without retrying it', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(response({ ok: false, status: 403 }));
    await expect(apiFetch('/patients')).rejects.toBeInstanceOf(ApiError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds retries when the server is unavailable', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(response({ ok: false, status: 503 }));
    await expect(apiFetch('/patients')).rejects.toBeInstanceOf(ApiError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not bounce a 401 across hostnames', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(response({ ok: false, status: 401 }));

    await expect(apiFetch('/patients')).rejects.toBeInstanceOf(ApiError);
    // One attempt per auth pass; 401 triggers token refresh, not a base flip.
    expect((globalThis.fetch as jest.Mock).mock.calls.every(([url]) => String(url).startsWith(API_BASE))).toBe(true);
  });

  it('routes a signed storage URL through the application origin', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(response({
      json: {
        upload_url: 'https://account.r2.cloudflarestorage.com/prod-svet/a.mp4?sig=abc',
        upload_id: 'upload-1',
      },
    }));

    const result = await apiFetch<{ upload_url: string }>('/uploads/request-url', {
      method: 'POST',
    });

    expect(result.upload_url).toBe(
      'https://luche.ai/r2/prod-svet/a.mp4?sig=abc',
    );
  });
});
