jest.mock('../clerk', () => ({
  clearClerkLocalSession: jest.fn(),
}));
jest.mock('../diagnostics', () => ({
  recordDiagnostic: jest.fn(),
  diagnosticErrorData: (error: Error) => ({ error: error.name, message: error.message }),
}));

import { recordDiagnostic } from '../diagnostics';
import { signOutFromDevice } from '../logout';

describe('signOutFromDevice', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses Clerk remote sign-out when the network path works', async () => {
    const remoteSignOut = jest.fn().mockResolvedValue(undefined);
    const deactivateSession = jest.fn();
    const clearLocalSession = jest.fn();

    await expect(signOutFromDevice({
      remoteSignOut,
      deactivateSession,
      clearLocalSession,
    })).resolves.toBe('remote');

    expect(deactivateSession).not.toHaveBeenCalled();
    expect(clearLocalSession).not.toHaveBeenCalled();
  });

  it('logs out locally when Clerk cannot revoke the session over the network', async () => {
    const remoteError = new TypeError('Network request failed');
    const remoteSignOut = jest.fn().mockRejectedValue(remoteError);
    const deactivateSession = jest.fn().mockResolvedValue(undefined);
    const clearLocalSession = jest.fn().mockResolvedValue(undefined);

    await expect(signOutFromDevice({
      remoteSignOut,
      deactivateSession,
      clearLocalSession,
    })).resolves.toBe('local');

    expect(deactivateSession).toHaveBeenCalledTimes(1);
    expect(clearLocalSession).toHaveBeenCalledTimes(1);
    expect(deactivateSession.mock.invocationCallOrder[0]).toBeLessThan(
      clearLocalSession.mock.invocationCallOrder[0],
    );
    expect(recordDiagnostic).toHaveBeenCalledWith(
      'logout_remote_signout_failed',
      expect.objectContaining({ message: 'Network request failed' }),
    );
    expect(recordDiagnostic).toHaveBeenCalledWith('logout_local_fallback_completed');
  });

  it('reports failure if the phone cannot erase its local Clerk state', async () => {
    const clearError = new Error('secure store unavailable');

    await expect(signOutFromDevice({
      remoteSignOut: jest.fn().mockRejectedValue(new Error('offline')),
      deactivateSession: jest.fn().mockResolvedValue(undefined),
      clearLocalSession: jest.fn().mockRejectedValue(clearError),
    })).rejects.toBe(clearError);
  });
});
