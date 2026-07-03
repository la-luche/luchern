import { useAuth, useSSO, useSignIn, useSignUp } from '@clerk/clerk-expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
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
import { Button } from './Button';
import { SocialButton } from './SocialButton';

// Required so the OAuth browser redirect can resolve back into the app.
WebBrowser.maybeCompleteAuthSession();

/** Warm up / cool down the in-app browser — smooths the Android OAuth cold start. */
function useWarmUpBrowser() {
  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center bg-white">{children}</View>;
}

/** Email one-time-code sign-in / sign-up (the instance's only first factor). */
function SignInScreen() {
  const { isLoaded: siLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: suLoaded, signUp, setActive: setActiveSignUp } = useSignUp();
  const insets = useSafeAreaInsets();
  const { startSSOFlow } = useSSO();
  useWarmUpBrowser();

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
        // No account yet → sign-up with an emailed code. The instance currently
        // also requires username + password, so we auto-generate both (the UX is
        // still passwordless email-code). If the instance is relaxed to
        // email-code-only, these extra fields are simply ignored.
        const local = email.trim().split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'user';
        const rand = Math.random().toString(36).slice(2, 8);
        await signUp!.create({
          emailAddress: email.trim(),
          username: `${local}_${rand}`.slice(0, 24),
          password: `Lz-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
        });
        await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' });
        setMode('signUp');
      }
      setStep('code');
    } catch (e: any) {
      setError(e?.errors?.[0]?.message ?? e?.message ?? 'Could not send a code to that email.');
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
        if (res.status !== 'complete') throw new Error('Sign-in incomplete.');
        await setActiveSignIn!({ session: res.createdSessionId });
      } else {
        const res = await signUp!.attemptEmailAddressVerification({ code: code.trim() });
        if (res.status !== 'complete') throw new Error('Sign-up incomplete.');
        await setActiveSignUp!({ session: res.createdSessionId });
      }
    } catch (e: any) {
      setError(e?.errors?.[0]?.message ?? e?.message ?? 'That code was not valid.');
    } finally {
      setBusy(false);
    }
  }

  const onSSO = useCallback(
    async (strategy: 'oauth_apple' | 'oauth_google') => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const { createdSessionId, setActive, authSessionResult } = await startSSOFlow({
          strategy,
          redirectUrl: AuthSession.makeRedirectUri(),
        });
        // User backed out of the browser → silent no-op, stay on the screen.
        if (authSessionResult?.type === 'cancel' || authSessionResult?.type === 'dismiss') {
          return;
        }
        if (createdSessionId) {
          await setActive!({ session: createdSessionId });
          return; // AuthGate's isSignedIn effect runs onboarding.
        }
        // Only reached on an unexpected incomplete/transfer state.
        throw new Error('Sign-in did not complete.');
      } catch (e: any) {
        setError(e?.errors?.[0]?.message ?? e?.message ?? 'Could not sign in. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [busy, startSSOFlow],
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-white"
    >
      <View
        className="flex-1 justify-center px-7"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <Text className="text-[28px] font-bold text-ink">Sign in to Luche</Text>
        <Text className="mt-2 text-[15px] text-ink-muted">
          {step === 'email'
            ? 'Enter your email — we’ll send a one-time code.'
            : `Enter the code we sent to ${email}.`}
        </Text>

        {step === 'email' && (
          <View className="mt-6">
            <SocialButton
              provider="apple"
              onPress={() => onSSO('oauth_apple')}
              disabled={busy || !ready}
            />
            <View className="mt-3">
              <SocialButton
                provider="google"
                onPress={() => onSSO('oauth_google')}
                disabled={busy || !ready}
              />
            </View>
            <View className="mt-6 flex-row items-center">
              <View className="h-px flex-1 bg-ink-faint" />
              <Text className="mx-3 text-[13px] text-ink-muted">or continue with email</Text>
              <View className="h-px flex-1 bg-ink-faint" />
            </View>
          </View>
        )}

        {step === 'email' ? (
          <TextInput
            className="mt-6 h-[52px] rounded-2xl border border-ink-faint px-4 text-[17px] text-ink"
            placeholder="you@example.com"
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
            placeholder="000000"
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
            <Button title={busy ? 'Sending…' : 'Send code'} onPress={sendCode} disabled={busy || !ready} />
          ) : (
            <>
              <Button title={busy ? 'Verifying…' : 'Verify'} onPress={verify} disabled={busy || !ready} />
              <View className="mt-3">
                <Button
                  title="Use a different email"
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
