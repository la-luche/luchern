import { ClerkProvider } from '@clerk/clerk-expo';
import { resourceCache } from '@clerk/clerk-expo/resource-cache';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';
import { AuthGate } from '../components/AuthGate';
import { DeidTestHarness } from '../components/DeidTestHarness';
import { DemoVideoProvider } from '../components/DemoVideoProvider';
import { DisclaimerGate } from '../components/DisclaimerGate';
import { TopBanners } from '../components/OfflineBanner';
import { CLERK_PUBLISHABLE_KEY, clerkTokenCache } from '../lib/clerk';
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

  if (process.env.EXPO_PUBLIC_DEID_TEST_MODE === '1') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <DeidTestHarness />
      </SafeAreaProvider>
    );
  }

  return (
    <ClerkProvider
      key={clerkAttempt}
      publishableKey={CLERK_PUBLISHABLE_KEY}
      tokenCache={clerkTokenCache}
      __experimental_resourceCache={resourceCache}
    >
      <LanguageProvider>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <DemoVideoProvider>
            <DisclaimerGate>
              <AuthGate onRetryAuth={() => setClerkAttempt((attempt) => attempt + 1)}>
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
