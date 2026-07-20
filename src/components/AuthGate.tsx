import { useAuth, useSignIn, useSignUp } from '@clerk/clerk-expo';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ensurePatientOnboarded } from '../lib/api';
import { useT } from '../lib/i18n';
import { Button } from './Button';

function Centered({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center bg-white">{children}</View>;
}

/** Email one-time-code sign-in / sign-up (the instance's only first factor). */
function SignInScreen() {
  const { isLoaded: siLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: suLoaded, signUp, setActive: setActiveSignUp } = useSignUp();
  const insets = useSafeAreaInsets();
  const t = useT();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = siLoaded && suLoaded;

  async function sendCode() {
    if (!ready || !email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      try {
        // Existing account → sign-in with an emailed code.
        const si = await signIn!.create({ identifier: email.trim() });
        const factor = si.supportedFirstFactors?.find((f) => f.strategy === 'email_code');
        if (!factor) throw new Error('email code unavailable');
        await signIn!.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: (factor as any).emailAddressId,
        });
        setMode('signIn');
      } catch {
        // No account yet → sign up with the same emailed-code flow. Production
        // Clerk intentionally has username and password authentication disabled.
        await signUp!.create({ emailAddress: email.trim() });
        await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' });
        setMode('signUp');
      }
      setStep('code');
    } catch (e: any) {
      setError(e?.errors?.[0]?.message ?? e?.message ?? t.auth.sendCodeError);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!ready || !code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signIn') {
        const res = await signIn!.attemptFirstFactor({ strategy: 'email_code', code: code.trim() });
        if (res.status !== 'complete') throw new Error(t.auth.signInIncomplete);
        await setActiveSignIn!({ session: res.createdSessionId });
      } else {
        const res = await signUp!.attemptEmailAddressVerification({ code: code.trim() });
        if (res.status !== 'complete') throw new Error(t.auth.signUpIncomplete);
        await setActiveSignUp!({ session: res.createdSessionId });
      }
    } catch (e: any) {
      setError(e?.errors?.[0]?.message ?? e?.message ?? t.auth.invalidCode);
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
            <Button title={busy ? t.auth.sending : t.auth.sendCode} onPress={sendCode} disabled={busy || !ready} />
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
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const onboarded = useRef(false);

  useEffect(() => {
    if (isSignedIn && !onboarded.current) {
      onboarded.current = true;
      ensurePatientOnboarded().catch(() => {
        onboarded.current = false; // let a later render retry
      });
    }
  }, [isSignedIn]);

  if (!isLoaded) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  if (!isSignedIn) return <SignInScreen />;
  return <>{children}</>;
}
