jest.mock('@clerk/clerk-expo', () => ({ getClerkInstance: jest.fn() }));
jest.mock('../diagnostics', () => ({
  diagnosticErrorData: (error: Error) => ({ error: error.name, message: error.message }),
  recordDiagnostic: jest.fn(),
}));

import { getClerkInstance } from '@clerk/clerk-expo';

import {
  API_BASE,
  FALLBACK_API_BASE,
  ApiError,
  ApiNetworkError,
  apiFetch,
} from '../api';
import {
  preferApiBase,
  registerClerkTransportFallback,
  resetPreferredApiBase,
} from '../edge';

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
    resetPreferredApiBase();
    (getClerkInstance as jest.Mock).mockReturnValue({
      session: { getToken: jest.fn().mockResolvedValue('token') },
    });
    global.fetch = jest.fn();
  });

  it('uses the canonical Pi backend', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response({ json: { patients: [] } }));

    await apiFetch('/patients');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      `${API_BASE}/patients`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });

  it('falls back to the Russian edge for a safe read', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(response({ json: { patients: [] } }));

    await apiFetch('/patients');

    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
      `${API_BASE}/patients`,
      `${FALLBACK_API_BASE}/patients`,
    ]);
  });

  it('retries a safe read on a fresh Russian-edge connection', async () => {
    preferApiBase(FALLBACK_API_BASE);
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(response({ json: { patients: [] } }));

    await apiFetch('/patients');

    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
      `${FALLBACK_API_BASE}/patients`,
      `${FALLBACK_API_BASE}/patients`,
    ]);
  });

  it('switches ClerkProvider when signed-in token refresh cannot use direct Clerk', async () => {
    const fallback = jest.fn(() => true);
    const unregister = registerClerkTransportFallback(fallback);
    (getClerkInstance as jest.Mock).mockReturnValue({
      session: { getToken: jest.fn().mockRejectedValue(new TypeError('Network request failed')) },
    });

    await expect(apiFetch('/trials/299')).rejects.toBeInstanceOf(ApiNetworkError);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();

    unregister();
  });

  it('retries one failed Clerk token refresh before surfacing an error', async () => {
    const getToken = jest.fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce('fresh-token');
    (getClerkInstance as jest.Mock).mockReturnValue({ session: { getToken } });
    (global.fetch as jest.Mock).mockResolvedValue(response({ json: { patients: [] } }));

    await apiFetch('/patients');

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
    expect(global.fetch).toHaveBeenCalledWith(
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
    (global.fetch as jest.Mock).mockResolvedValue(response({ json: {} }));

    const requests = Promise.all([apiFetch('/patients'), apiFetch('/me/trials')]);
    resolveToken('shared-token');
    await requests;

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes the token and repeats a request after an explicit 401', async () => {
    const getToken = jest.fn()
      .mockResolvedValueOnce('expired-token')
      .mockResolvedValueOnce('fresh-token');
    (getClerkInstance as jest.Mock).mockReturnValue({ session: { getToken } });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response({ ok: false, status: 401 }))
      .mockResolvedValueOnce(response({ json: { patients: [] } }));

    await apiFetch('/patients');

    expect(getToken).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[1][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      }),
    );
  });

  it('does not repeat an ambiguous POST but sends its retry to the other edge', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(apiFetch('/invites', { method: 'POST' })).rejects.toBeInstanceOf(
      ApiNetworkError,
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);

    (global.fetch as jest.Mock).mockResolvedValueOnce(response({ json: { token: '1234' } }));
    await apiFetch('/invites', { method: 'POST' });
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(`${FALLBACK_API_BASE}/invites`);
  });

  it('surfaces HTTP responses without trying another hostname', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response({ ok: false, status: 403 }));

    await expect(apiFetch('/patients')).rejects.toBeInstanceOf(ApiError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('routes a Russian-edge presigned URL through its R2 proxy', async () => {
    preferApiBase(FALLBACK_API_BASE);
    (global.fetch as jest.Mock).mockResolvedValueOnce(response({
      json: {
        upload_url: 'https://account.r2.cloudflarestorage.com/prod-svet/a.mp4?sig=abc',
        upload_id: 'upload-1',
      },
    }));

    const result = await apiFetch<{ upload_url: string }>('/uploads/request-url', {
      method: 'POST',
    });

    expect(result.upload_url).toBe(
      'https://xn--e1alyq.xn--p1ai/r2/prod-svet/a.mp4?sig=abc',
    );
  });
});
