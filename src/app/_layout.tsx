import { ClerkProvider } from '@clerk/clerk-expo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';

import { AuthGate } from '../components/AuthGate';
import { DeidTestHarness } from '../components/DeidTestHarness';
import { DemoVideoProvider } from '../components/DemoVideoProvider';
import { DisclaimerGate } from '../components/DisclaimerGate';
import { TopBanners } from '../components/OfflineBanner';
import { CLERK_PUBLISHABLE_KEY, clerkResourceCache, clerkTokenCache } from '../lib/clerk';
import { recordDiagnostic } from '../lib/diagnostics';
import {
  PRIMARY_API_BASE,
  RUSSIAN_API_BASE,
  RUSSIAN_CLERK_PROXY,
  persistClerkTransport,
  preferApiBase,
  registerClerkTransportFallback,
  selectClerkProxyUrl,
} from '../lib/edge';
import { LanguageProvider } from '../lib/i18n';
import { installRequestLog } from '../lib/requestLog';
import { ToastHost } from '../lib/toast';

installRequestLog();

// Single stack for the whole app. Headers are hidden — each screen draws its
// own minimal top bar to match the Luche look. App is portrait-locked and
// light-mode via app.json.
//
// Wrapped in ClerkProvider (auth) → DisclaimerGate (medical disclaimer, first
// launch) → AuthGate (email-code sign-in). All app screens run signed-in, so
// every backend call carries a Clerk session token.
export default function RootLayout() {
  const [clerkAttempt, setClerkAttempt] = useState(0);
  const [clerkProxyUrl, setClerkProxyUrl] = useState<string | undefined | null>(null);
  const [authRetry, setAuthRetry] = useState<{ email: string; nonce: number } | null>(null);
  const authRetryNonce = useRef(0);
  const clerkProxyUrlRef = useRef<string | undefined | null>(null);

  useEffect(() => {
    clerkProxyUrlRef.current = clerkProxyUrl;
  }, [clerkProxyUrl]);

  const probing = useRef(false);
  const configureClerkTransport = useCallback(async (opts?: { silent?: boolean }) => {
    if (probing.current) return;
    probing.current = true;
    try {
      // A silent re-probe keeps the running app mounted while the health
      // checks run and only remounts ClerkProvider if the transport actually
      // changes — a stale retry must never blank a healthy session.
      if (!opts?.silent) setClerkProxyUrl(null);
      const proxyUrl = await selectClerkProxyUrl();
      const changed = clerkProxyUrlRef.current !== proxyUrl;
      setClerkProxyUrl(proxyUrl);
      if (!opts?.silent || changed) setClerkAttempt((attempt) => attempt + 1);
    } finally {
      probing.current = false;
    }
  }, []);

  useEffect(() => {
    void configureClerkTransport();
  }, [configureClerkTransport]);

  const switchClerkTransport = useCallback(() => {
    setAuthRetry(null);
    // Retry assumes nothing about which route is healthy: re-run the health
    // probes so a session stuck on a dead route (in either direction) can
    // escape without a cold start. If a silent probe is already in flight,
    // surface its progress instead of silently dropping the tap.
    if (probing.current) {
      setClerkProxyUrl(null);
      return;
    }
    void configureClerkTransport();
  }, [configureClerkTransport]);

  const switchDirectClerkToRussian = useCallback((): boolean => {
    if (clerkProxyUrlRef.current !== undefined) return false;

    clerkProxyUrlRef.current = RUSSIAN_CLERK_PROXY;
    // Runtime proof that direct is unusable here (bootstrap hang / auth
    // failure despite a passing probe) — remember it for future launches.
    recordDiagnostic('clerk_transport_flip', { to: 'ru-edge' });
    persistClerkTransport('ru-edge');
    preferApiBase(RUSSIAN_API_BASE);
    setClerkProxyUrl(RUSSIAN_CLERK_PROXY);
    setClerkAttempt((attempt) => attempt + 1);
    return true;
  }, []);

  /** Force a session off the Russian proxy onto direct Clerk. Runtime proof
   * (a hang on the edge) outranks the persisted verdict, which is rewritten
   * so the next launch doesn't walk back into the same hang. */
  const forceDirectClerk = useCallback((): boolean => {
    if (clerkProxyUrlRef.current !== RUSSIAN_CLERK_PROXY) return false;
    recordDiagnostic('clerk_transport_flip', { to: 'direct' });
    persistClerkTransport('direct');
    clerkProxyUrlRef.current = undefined;
    preferApiBase(PRIMARY_API_BASE);
    setClerkProxyUrl(undefined);
    setClerkAttempt((attempt) => attempt + 1);
    return true;
  }, []);

  /** Bootstrap watchdog escape hatch — bidirectional, so a persisted ru-edge
   * verdict whose edge probes fine but hangs the bootstrap is never a dead
   * end: direct-side hang → edge; edge-side hang → direct. */
  const bootstrapFlips = useRef(0);
  const recoverBootstrapTransport = useCallback((): boolean => {
    // Damped: two flips (one in each direction) prove that NEITHER transport
    // can bootstrap — further oscillation would remount ClerkProvider every
    // 8 s forever and scribble the persisted verdict on every swing. Stop
    // and let AuthGate surface the connection alert instead.
    if (bootstrapFlips.current >= 2) return false;
    bootstrapFlips.current += 1;
    if (clerkProxyUrlRef.current === undefined) return switchDirectClerkToRussian();
    return forceDirectClerk();
  }, [forceDirectClerk, switchDirectClerkToRussian]);

  const reprobeAt = useRef(0);
  const recoverClerkTransport = useCallback((): boolean => {
    if (clerkProxyUrlRef.current === null) return false; // probe already running
    if (clerkProxyUrlRef.current === undefined) return switchDirectClerkToRussian();
    // A token-refresh connection failure on the Russian proxy may mean the
    // edge itself is down. Re-run the probes so the session can escape; the
    // cooldown keeps transient blips from remount-thrashing ClerkProvider.
    // NOTE: the probe takes up to ~3.5 s, so the caller's immediate token
    // retry still runs on the old transport — recovery lands on the NEXT
    // request, not this one.
    if (probing.current) return false;
    const now = Date.now();
    if (now - reprobeAt.current < 30_000) return false;
    reprobeAt.current = now;
    void configureClerkTransport({ silent: true });
    return true;
  }, [configureClerkTransport, switchDirectClerkToRussian]);

  useEffect(
    () => registerClerkTransportFallback(recoverClerkTransport),
    [recoverClerkTransport],
  );

  const retryAuthViaOtherTransport = useCallback((email: string): boolean => {
    if (clerkProxyUrlRef.current === null) return false; // probe in flight

    authRetryNonce.current += 1;
    setAuthRetry({ email, nonce: authRetryNonce.current });
    if (clerkProxyUrlRef.current === undefined) return switchDirectClerkToRussian();

    // A sign-in hung on the Russian edge: force direct for this session and
    // replay there — an auth dead end on either route is never acceptable.
    return forceDirectClerk();
  }, [forceDirectClerk, switchDirectClerkToRussian]);

  const consumeAuthRetry = useCallback(() => setAuthRetry(null), []);

  if (process.env.EXPO_PUBLIC_DEID_TEST_MODE === '1') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <DeidTestHarness />
      </SafeAreaProvider>
    );
  }

  if (clerkProxyUrl === null) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <ClerkProvider
      key={`${clerkAttempt}:${clerkProxyUrl ?? 'direct'}`}
      publishableKey={CLERK_PUBLISHABLE_KEY}
      proxyUrl={clerkProxyUrl}
      tokenCache={clerkTokenCache}
      __experimental_resourceCache={clerkResourceCache}
    >
      <LanguageProvider>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <DemoVideoProvider>
            <DisclaimerGate>
              <AuthGate
                onRetryAuth={switchClerkTransport}
                authRetry={authRetry}
                onAuthRetryConsumed={consumeAuthRetry}
                onDirectBootstrapFailure={recoverBootstrapTransport}
                onDirectAuthFailure={retryAuthViaOtherTransport}
              >
                <View className="flex-1 bg-white">
                  <TopBanners />
                  <SafeAreaProvider style={{ flex: 1 }}>
                    <Stack
                      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}
                    >
                      <Stack.Screen name="index" />
                      <Stack.Screen name="tests" />
                      <Stack.Screen name="guests/index" />
                      <Stack.Screen name="guests/new" />
                      <Stack.Screen name="guests/[id]" />
                      <Stack.Screen name="test/[id]" />
                      <Stack.Screen name="record/[id]" options={{ gestureEnabled: false }} />
                      <Stack.Screen name="results/index" />
                      <Stack.Screen name="results/[id]" />
                      <Stack.Screen name="shared/[id]" />
                      <Stack.Screen name="invite" />
                      <Stack.Screen name="share-code" />
                      <Stack.Screen name="about" options={{ presentation: 'modal' }} />
                    </Stack>
                    <ToastHost />
                  </SafeAreaProvider>
                </View>
              </AuthGate>
            </DisclaimerGate>
          </DemoVideoProvider>
        </SafeAreaProvider>
      </LanguageProvider>
    </ClerkProvider>
  );
}
