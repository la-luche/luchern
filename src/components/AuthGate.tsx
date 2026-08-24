import { useAuth, useSignIn, useSignUp } from '@clerk/clerk-expo';
import * as FileSystem from 'expo-file-system/legacy';
import { useNetworkState } from 'expo-network';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ensurePatientOnboarded } from '../lib/api';
import {
  isConnectionFailure,
  isMissingClerkAccount,
  showConnectionAlert,
  withTimeout,
} from '../lib/connectivity';
import { diagnosticErrorData, exportDiagnostics, recordDiagnostic } from '../lib/diagnostics';
import { useT } from '../lib/i18n';
import { Button } from './Button';
import { ConnectionProblem } from './ConnectionProblem';

// Generous by design: on throttled networks (RU direct) each Clerk round trip
// can take 4+ s and the sign-in flow is several of them. A slow route that
// finishes beats a fast timeout that forces transport flip-and-retry churn.
const AUTH_REQUEST_TIMEOUT_MS = 30_000;
const AUTH_BOOTSTRAP_SLOW_MS = 8_000;

function Centered({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center bg-white">{children}</View>;
}

/** Email one-time-code sign-in / sign-up (the instance's only first factor). */
type AuthRetry = { email: string; nonce: number };

function SignInScreen({
  authRetry,
  onAuthRetryConsumed,
  onDirectAuthFailure,
}: {
  authRetry: AuthRetry | null;
  onAuthRetryConsumed: () => void;
  onDirectAuthFailure: (email: string) => boolean;
}) {
  const { isLoaded: siLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: suLoaded, signUp, setActive: setActiveSignUp } = useSignUp();
  const insets = useSafeAreaInsets();
  const net = useNetworkState();
  const t = useT();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState(authRetry?.email ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAuthRetry = useRef<number | null>(null);

  const ready = siLoaded && suLoaded;
  // isInternetReachable is Android's Google connectivity probe — on DPI
  // networks that blackhole Google it reports false while the Russian edge is
  // perfectly reachable, and gating on it here vetoes the exact ru-edge
  // fallback built for those networks (observed 2026-08-19). Only a missing
  // network connection blocks an attempt; reachability=false is unknown.
  const offline = net.isConnected === false;

  const showFailure = useCallback(
    (retry: () => void, error?: unknown) => {
      if (offline || isConnectionFailure(error)) {
        showConnectionAlert(t, retry, offline);
        return true;
      }
      return false;
    },
    [offline, t],
  );

  const sendCodeForEmail = useCallback(async (
    emailValue: string,
    allowRussianFallback: boolean,
  ) => {
    const identifier = emailValue.trim();
    if (!ready || !identifier || busy) return;
    if (offline) {
      showConnectionAlert(t, () => void sendCodeForEmail(identifier, false), true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let si: Awaited<ReturnType<NonNullable<typeof signIn>['create']>> | null = null;
      try {
        // Existing account → sign-in with an emailed code.
        si = await withTimeout(
          signIn!.create({ identifier }),
          AUTH_REQUEST_TIMEOUT_MS,
          'send sign-in code',
        );
      } catch (error) {
        if (!isMissingClerkAccount(error)) throw error;
      }

      if (si) {
        const factor = si.supportedFirstFactors?.find((f) => f.strategy === 'email_code');
        if (!factor) throw new Error('email code unavailable');
        await withTimeout(signIn!.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: (factor as any).emailAddressId,
        }), AUTH_REQUEST_TIMEOUT_MS, 'prepare sign-in code');
        setMode('signIn');
      } else {
        // No account yet → sign up with the same emailed-code flow. Production
        // Clerk intentionally has username and password authentication disabled.
        await withTimeout(
          signUp!.create({ emailAddress: identifier }),
          AUTH_REQUEST_TIMEOUT_MS,
          'create account',
        );
        await withTimeout(
          signUp!.prepareEmailAddressVerification({ strategy: 'email_code' }),
          AUTH_REQUEST_TIMEOUT_MS,
          'prepare sign-up code',
        );
        setMode('signUp');
      }
      setStep('code');
    } catch (e: any) {
      recordDiagnostic('auth_send_code_failed', {
        flipAllowed: allowRussianFallback,
        ...diagnosticErrorData(e),
      });
      if (
        allowRussianFallback
        && isConnectionFailure(e)
        && onDirectAuthFailure(identifier)
      ) {
        recordDiagnostic('auth_transport_flip', { trigger: 'send_code' });
        return;
      }
      if (!showFailure(() => void sendCodeForEmail(identifier, false), e)) {
        setError(e?.errors?.[0]?.message ?? e?.message ?? t.auth.sendCodeError);
      }
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    offline,
    onDirectAuthFailure,
    ready,
    showFailure,
    signIn,
    signUp,
    t,
  ]);

  const sendCode = useCallback(
    () => sendCodeForEmail(email, true),
    [email, sendCodeForEmail],
  );

  // Same exporter as the About screen, reachable signed-out: when sign-in
  // itself fails there is no other way to get the transport diagnostics off
  // the device (release builds are not debuggable).
  const downloadLogs = useCallback(async () => {
    try {
      if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) {
        throw new Error('sharing unavailable');
      }
      const uri = `${FileSystem.cacheDirectory}luche-diagnostics.json`;
      await FileSystem.writeAsStringAsync(uri, await exportDiagnostics());
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: t.about.diagnosticsShareTitle,
        UTI: 'public.json',
      });
    } catch {
      Alert.alert(t.about.diagnosticsFailedTitle, t.about.diagnosticsFailedBody);
    }
  }, [t]);

  useEffect(() => {
    if (
      !ready
      || !authRetry
      || startedAuthRetry.current === authRetry.nonce
    ) return;

    startedAuthRetry.current = authRetry.nonce;
    setEmail(authRetry.email);
    onAuthRetryConsumed();
    void sendCodeForEmail(authRetry.email, false);
  }, [authRetry, onAuthRetryConsumed, ready, sendCodeForEmail]);

  async function verify() {
    if (!ready || !code.trim() || busy) return;
    if (offline) {
      showConnectionAlert(t, () => void verify(), true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signIn') {
        console.info('AUTH_VERIFY_STAGE sign_in_attempt_start');
        const res = await withTimeout(
          signIn!.attemptFirstFactor({ strategy: 'email_code', code: code.trim() }),
          AUTH_REQUEST_TIMEOUT_MS,
          'verify sign-in code',
        );
        console.info(`AUTH_VERIFY_STAGE sign_in_attempt_complete status=${res.status}`);
        if (res.status !== 'complete') throw new Error(t.auth.signInIncomplete);
        console.info('AUTH_VERIFY_STAGE sign_in_set_active_start');
        await withTimeout(
          setActiveSignIn!({ session: res.createdSessionId }),
          AUTH_REQUEST_TIMEOUT_MS,
          'activate sign-in session',
        );
        console.info('AUTH_VERIFY_STAGE sign_in_set_active_complete');
      } else {
        console.info('AUTH_VERIFY_STAGE sign_up_attempt_start');
        const res = await withTimeout(
          signUp!.attemptEmailAddressVerification({ code: code.trim() }),
          AUTH_REQUEST_TIMEOUT_MS,
          'verify sign-up code',
        );
        console.info(`AUTH_VERIFY_STAGE sign_up_attempt_complete status=${res.status}`);
        if (res.status !== 'complete') throw new Error(t.auth.signUpIncomplete);
        console.info('AUTH_VERIFY_STAGE sign_up_set_active_start');
        await withTimeout(
          setActiveSignUp!({ session: res.createdSessionId }),
          AUTH_REQUEST_TIMEOUT_MS,
          'activate sign-up session',
        );
        console.info('AUTH_VERIFY_STAGE sign_up_set_active_complete');
      }
    } catch (e: any) {
      recordDiagnostic('auth_verify_failed', { mode, ...diagnosticErrorData(e) });
      if (!showFailure(() => void verify(), e)) {
        setError(e?.errors?.[0]?.message ?? e?.message ?? t.auth.invalidCode);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-white"
    >
      <View
        className="flex-1 justify-center px-7"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <Text className="text-[28px] font-bold text-ink">{t.auth.signInTitle}</Text>
        <Text className="mt-2 text-[15px] text-ink-muted">
          {step === 'email' ? t.auth.emailSubtitle : t.auth.codeSubtitle(email)}
        </Text>

        {step === 'email' ? (
          <TextInput
            className="mt-6 h-[52px] rounded-2xl border border-ink-faint px-4 text-[17px] text-ink"
            placeholder={t.auth.emailPlaceholder}
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
            editable={!busy}
            onSubmitEditing={sendCode}
            returnKeyType="send"
          />
        ) : (
          <TextInput
            className="mt-6 h-[52px] rounded-2xl border border-ink-faint px-4 text-[22px] tracking-[8px] text-ink"
            placeholder={t.auth.codePlaceholder}
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            value={code}
            onChangeText={setCode}
            editable={!busy}
            onSubmitEditing={verify}
            returnKeyType="done"
            maxLength={6}
          />
        )}

        {error && <Text className="mt-3 text-[13px] text-red-600">{error}</Text>}

        <View className="mt-6">
          {step === 'email' ? (
            <>
              <Button title={busy ? t.auth.sending : t.auth.sendCode} onPress={sendCode} disabled={busy || !ready} />
              <View className="mt-3">
                <Button
                  title={t.auth.downloadLogs}
                  variant="secondary"
                  onPress={() => void downloadLogs()}
                  disabled={busy}
                />
              </View>
            </>
          ) : (
            <>
              <Button title={busy ? t.auth.verifying : t.auth.verify} onPress={verify} disabled={busy || !ready} />
              <View className="mt-3">
                <Button
                  title={t.auth.useDifferentEmail}
                  variant="secondary"
                  onPress={() => {
                    setStep('email');
                    setCode('');
                    setError(null);
                  }}
                  disabled={busy}
                />
              </View>
            </>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * Gates the app behind Clerk sign-in. While Clerk loads → spinner; signed out →
 * the email-code screen; signed in → the app (and idempotently onboard the
 * caller as a 'patient' the first time).
 */
export function AuthGate({
  children,
  onRetryAuth,
  authRetry,
  onAuthRetryConsumed,
  onDirectBootstrapFailure,
  onDirectAuthFailure,
}: {
  children: React.ReactNode;
  onRetryAuth: () => void;
  authRetry: AuthRetry | null;
  onAuthRetryConsumed: () => void;
  onDirectBootstrapFailure: () => boolean;
  onDirectAuthFailure: (email: string) => boolean;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const net = useNetworkState();
  const t = useT();
  const onboarded = useRef(false);
  const alertShown = useRef(false);
  // A native alert can outlive the outage it reported; its Try-again must be
  // a no-op once Clerk has loaded, or a stale tap restarts a healthy session.
  const isLoadedRef = useRef(isLoaded);
  isLoadedRef.current = isLoaded;
  const retryIfStillStuck = useCallback(() => {
    if (!isLoadedRef.current) onRetryAuth();
  }, [onRetryAuth]);
  const [slow, setSlow] = useState(false);
  // Same rule as SignInScreen: reachability=false is Android's blocked Google
  // probe, not proof of no connectivity — it must not suppress the bootstrap
  // transport flip on partially-blocked networks.
  const offline = net.isConnected === false;

  useEffect(() => {
    if (isLoaded) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), AUTH_BOOTSTRAP_SLOW_MS);
    return () => clearTimeout(timer);
  }, [isLoaded]);

  useEffect(() => {
    if (isLoaded || (!offline && !slow) || alertShown.current) return;
    if (!offline && slow && onDirectBootstrapFailure()) {
      recordDiagnostic('auth_bootstrap_slow', { recovered: 'transport_flip' });
      return;
    }
    recordDiagnostic('auth_bootstrap_slow', { recovered: 'alert', offline });
    alertShown.current = true;
    showConnectionAlert(t, retryIfStillStuck, offline);
  }, [isLoaded, offline, onDirectBootstrapFailure, retryIfStillStuck, slow, t]);

  useEffect(() => {
    if (isSignedIn && !onboarded.current) {
      onboarded.current = true;
      ensurePatientOnboarded().catch(() => {
        onboarded.current = false; // let a later render retry
      });
    }
  }, [isSignedIn]);

  if (!isLoaded) {
    if (offline || slow) {
      return (
        <ConnectionProblem
          title={offline ? t.connection.offlineTitle : t.connection.problemTitle}
          body={offline ? t.connection.offlineBody : t.connection.problemBody}
          retryLabel={t.connection.tryAgain}
          onRetry={onRetryAuth}
        />
      );
    }
    return (
      <Centered>
        <ActivityIndicator />
        <Text className="mt-3 text-[15px] text-ink-muted">{t.connection.connecting}</Text>
      </Centered>
    );
  }
  if (!isSignedIn) {
    return (
      <SignInScreen
        authRetry={authRetry}
        onAuthRetryConsumed={onAuthRetryConsumed}
        onDirectAuthFailure={onDirectAuthFailure}
      />
    );
  }
  return <>{children}</>;
}
