jest.mock('@clerk/clerk-expo', () => ({ getClerkInstance: jest.fn() }));
jest.mock('../diagnostics', () => ({
  diagnosticErrorData: (error: Error) => ({ error: error.name, message: error.message }),
  recordDiagnostic: jest.fn(),
}));

import { getClerkInstance } from '@clerk/clerk-expo';

import {
  API_BASE,
  LEGACY_API_BASE,
  ApiError,
  ApiNetworkError,
  apiFetch,
} from '../api';

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
    global.fetch = jest.fn();
  });

  it('uses the Luche product domain first', async () => {
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

  it('falls back to the legacy hostname for safe reads after a transport failure', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(response({ json: { patients: [] } }));

    await apiFetch('/patients');

    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
      `${API_BASE}/patients`,
      `${LEGACY_API_BASE}/patients`,
    ]);
  });

  it('never repeats a POST on another hostname after an ambiguous network failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

    await expect(apiFetch('/invites', { method: 'POST' })).rejects.toBeInstanceOf(
      ApiNetworkError,
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces HTTP responses without trying another hostname', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response({ ok: false, status: 403 }));

    await expect(apiFetch('/patients')).rejects.toBeInstanceOf(ApiError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
