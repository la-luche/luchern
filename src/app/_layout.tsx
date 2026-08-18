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
import {
  RUSSIAN_API_BASE,
  RUSSIAN_CLERK_PROXY,
  preferApiBase,
  registerClerkTransportFallback,
  selectClerkProxyUrl,
} from '../lib/edge';
import { LanguageProvider } from '../lib/i18n';
import { ToastHost } from '../lib/toast';

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

  const configureClerkTransport = useCallback(async () => {
    setClerkProxyUrl(null);
    const proxyUrl = await selectClerkProxyUrl();
    setClerkProxyUrl(proxyUrl);
    setClerkAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    void configureClerkTransport();
  }, [configureClerkTransport]);

  const switchClerkTransport = useCallback(() => {
    setAuthRetry(null);
    // Retry assumes nothing about which route is healthy: re-run the health
    // probes so a session stuck on a dead route (in either direction) can
    // escape without a cold start.
    void configureClerkTransport();
  }, [configureClerkTransport]);

  const switchDirectClerkToRussian = useCallback((): boolean => {
    if (clerkProxyUrlRef.current !== undefined) return false;

    clerkProxyUrlRef.current = RUSSIAN_CLERK_PROXY;
    preferApiBase(RUSSIAN_API_BASE);
    setClerkProxyUrl(RUSSIAN_CLERK_PROXY);
    setClerkAttempt((attempt) => attempt + 1);
    return true;
  }, []);

  const reprobeAt = useRef(0);
  const recoverClerkTransport = useCallback((): boolean => {
    if (clerkProxyUrlRef.current === null) return false; // probe already running
    if (clerkProxyUrlRef.current === undefined) return switchDirectClerkToRussian();
    // A token-refresh connection failure on the Russian proxy may mean the
    // edge itself is down. Re-run the probes so the session can escape; the
    // cooldown keeps transient blips from remount-thrashing ClerkProvider.
    const now = Date.now();
    if (now - reprobeAt.current < 30_000) return false;
    reprobeAt.current = now;
    void configureClerkTransport();
    return true;
  }, [configureClerkTransport, switchDirectClerkToRussian]);

  useEffect(
    () => registerClerkTransportFallback(recoverClerkTransport),
    [recoverClerkTransport],
  );

  const retryAuthViaRussianEdge = useCallback((email: string): boolean => {
    // `undefined` is Clerk's direct transport. Never bounce a failed Russian
    // request back to the route that was already blocked.
    if (clerkProxyUrl !== undefined) return false;

    authRetryNonce.current += 1;
    setAuthRetry({ email, nonce: authRetryNonce.current });
    return switchDirectClerkToRussian();
  }, [clerkProxyUrl, switchDirectClerkToRussian]);

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
                onDirectBootstrapFailure={switchDirectClerkToRussian}
                onDirectAuthFailure={retryAuthViaRussianEdge}
              >
                <View className="flex-1 bg-white">
                  <TopBanners />
                  <SafeAreaProvider style={{ flex: 1 }}>
                    <Stack
                      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}
                    >
                      <Stack.Screen name="index" />
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
