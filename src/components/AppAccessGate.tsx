import { useAuth, useClerk } from '@clerk/clerk-expo';
import { useNetworkState } from 'expo-network';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, AppState, Text, View } from 'react-native';
import { ensurePatientOnboarded } from '../lib/api';
import { fetchMyAppAccess, forgetAppAccess, hasApprovedAppAccess, rememberAppAccess } from '../lib/appAccess';
import { useT } from '../lib/i18n';
import { signOutFromDevice } from '../lib/logout';
import { suspendRecordingAccessForAuthLoss } from '../lib/storage';
import { ConnectionProblem } from './ConnectionProblem';
import { WaitlistScreen } from './WaitlistScreen';

type State = { accountId: string; status: 'checking' | 'approved' | 'pending' | 'error'; email?: string | null };

/** A Clerk session proves identity; Luche approval grants access to the app. */
export function AppAccessGate({ accountId, children }: { accountId: string; children: ReactNode }) {
  const { signOut } = useAuth();
  const clerk = useClerk();
  const net = useNetworkState();
  const t = useT();
  const [state, setState] = useState<State>({ accountId, status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const [switchingEmail, setSwitchingEmail] = useState(false);
  const retry = () => setAttempt(n => n + 1);
  const changeEmail = async () => {
    if (switchingEmail) return;
    setSwitchingEmail(true);
    try {
      suspendRecordingAccessForAuthLoss();
      await signOutFromDevice({ remoteSignOut: () => signOut(), deactivateSession: () => clerk.setActive({ session: null }) });
    } catch { Alert.alert(t.connection.problemTitle, t.auth.genericError); }
    finally { setSwitchingEmail(false); }
  };

  useEffect(() => {
    let cancelled = false;
    const show = (next: Omit<State, 'accountId'>) => { if (!cancelled) setState({ ...next, accountId }); };
    void (async () => {
      let cached = false;
      try {
        cached = await hasApprovedAppAccess(accountId);
        if (cancelled) return;
        show({ status: cached ? 'approved' : 'checking' });
        if (net.isConnected === false) { if (!cached) show({ status: 'error' }); return; }
        const access = await fetchMyAppAccess(accountId);
        if (cancelled) return;
        if (access.status === 'approved') {
          if (!cached) await ensurePatientOnboarded(accountId);
          if (cancelled) return;
          await rememberAppAccess(accountId);
          show({ status: 'approved' });
        } else if (access.status === 'pending') {
          cached = false;
          show({ status: 'pending', email: access.email });
          await forgetAppAccess(accountId);
          if (cancelled) return;
          suspendRecordingAccessForAuthLoss();
          show({ status: 'pending', email: access.email });
        } else throw new Error('invalid access response');
      } catch { if (!cached) show({ status: 'error' }); }
    })();
    return () => { cancelled = true; };
  }, [accountId, attempt, net.isConnected]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', next => { if (next === 'active') setAttempt(n => n + 1); });
    return () => listener.remove();
  }, []);

  const current = state.accountId === accountId ? state : { accountId, status: 'checking' as const };
  if (current.status === 'approved') return <>{children}</>;
  if (current.status === 'pending') return <WaitlistScreen email={current.email} busy={switchingEmail} onCheck={retry} onChangeEmail={() => { void changeEmail(); }} />;
  if (current.status === 'error') return <ConnectionProblem title={t.connection.problemTitle} body={t.connection.problemBody}
    retryLabel={t.connection.tryAgain} onRetry={retry} secondaryLabel={t.auth.useDifferentEmail}
    onSecondary={() => { void changeEmail(); }} disabled={switchingEmail} />;
  return <View className="flex-1 items-center justify-center bg-white">
    <ActivityIndicator /><Text className="mt-3 text-[17px] text-ink-muted">{t.auth.checkingAccess}</Text>
  </View>;
}
