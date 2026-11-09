import nativeRecovery from '../../modules/network-recovery';
import { recordDiagnostic } from './diagnostics';

const HOSTS = new Set(['luche.ai', 'go.luche.ai', 'doctor.luche.ai']);
let pending: Promise<boolean> | undefined;

/** Called only on transport failure or our own deadline, never HTTP errors.
 * Does not replay a request. Existing read retries / explicit user retries own
 * that decision, so ambiguous writes cannot accidentally run twice. */
export async function recoverConnection(url: string): Promise<boolean> {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname)) return false;
    host = parsed.hostname;
  } catch { return false; }
  if (!nativeRecovery) return false;
  if (pending) return pending;
  pending = nativeRecovery.activate(host)
    .then((activated) => {
      if (activated) recordDiagnostic('connection_recovery_enabled', { host });
      return activated;
    })
    .catch(() => false)
    .finally(() => { pending = undefined; });
  return pending;
}
