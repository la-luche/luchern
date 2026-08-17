import { clearClerkLocalSession } from './clerk';
import { diagnosticErrorData, recordDiagnostic } from './diagnostics';

interface SignOutFromDeviceOptions {
  remoteSignOut: () => Promise<void>;
  deactivateSession: () => Promise<void>;
  clearLocalSession?: () => Promise<void>;
}

/**
 * Revoke the Clerk session remotely when possible. A network failure must not
 * prevent logout on the phone: deactivate Clerk in memory, then durably erase
 * every local token and cached signed-in snapshot.
 */
export async function signOutFromDevice({
  remoteSignOut,
  deactivateSession,
  clearLocalSession = clearClerkLocalSession,
}: SignOutFromDeviceOptions): Promise<'remote' | 'local'> {
  try {
    await remoteSignOut();
    return 'remote';
  } catch (error) {
    recordDiagnostic('logout_remote_signout_failed', diagnosticErrorData(error));
    await deactivateSession();
    await clearLocalSession();
    recordDiagnostic('logout_local_fallback_completed');
    return 'local';
  }
}
