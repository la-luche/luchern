import { ClerkProvider } from '@clerk/clerk-expo';
import { resourceCache } from '@clerk/clerk-expo/resource-cache';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';
import { AuthGate } from '../components/AuthGate';
import { DeidTestHarness } from '../components/DeidTestHarness';
import { DemoVideoProvider } from '../components/DemoVideoProvider';
import { DisclaimerGate } from '../components/DisclaimerGate';
import { TopBanners } from '../components/OfflineBanner';
import { CLERK_PUBLISHABLE_KEY, clerkTokenCache } from '../lib/clerk';
import {
  PRIMARY_API_BASE,
  RUSSIAN_API_BASE,
  RUSSIAN_CLERK_PROXY,
  preferApiBase,
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
    setClerkProxyUrl((current) => {
      const next = current ? undefined : RUSSIAN_CLERK_PROXY;
      preferApiBase(next ? RUSSIAN_API_BASE : PRIMARY_API_BASE);
      return next;
    });
    setClerkAttempt((attempt) => attempt + 1);
  }, []);

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
      __experimental_resourceCache={resourceCache}
    >
      <LanguageProvider>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <DemoVideoProvider>
            <DisclaimerGate>
              <AuthGate onRetryAuth={switchClerkTransport}>
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
