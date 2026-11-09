import { ClerkProvider } from '@clerk/clerk-expo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';

import { AuthGate } from '../components/AuthGate';
import { DeidTestHarness } from '../components/DeidTestHarness';
import { DemoVideoProvider } from '../components/DemoVideoProvider';
import { DisclaimerGate } from '../components/DisclaimerGate';
import { LanguageSetupGate } from '../components/LanguageSetupGate';
import { TopBanners } from '../components/OfflineBanner';
import { ProcessingNotifications } from '../components/ProcessingNotifications';
import { BUNDLED_GIT_COMMIT } from '../generated/release';
import { CLERK_PUBLISHABLE_KEY, clerkResourceCache, clerkTokenCache } from '../lib/clerk';
import { recordDiagnostic } from '../lib/diagnostics';
import { CLERK_PROXY_URL } from '../lib/edge';
import { LanguageProvider } from '../lib/i18n';
import { installRequestLog } from '../lib/requestLog';
import { ToastHost } from '../lib/toast';

installRequestLog();
if (BUNDLED_GIT_COMMIT) {
  console.info(`[luche] ${BUNDLED_GIT_COMMIT.bundleMarker}`);
}

// Single stack for the whole app. Headers are hidden — each screen draws its
// own minimal top bar to match the Luche look. App is portrait-locked and
// light-mode via app.json.
//
// The once-per-launch warning sits outside Clerk's retry boundary so a
// login retry cannot reset it. AuthGate keeps app screens signed-in.
export default function RootLayout() {
  const [clerkAttempt, setClerkAttempt] = useState(0);
  const bootstrapRetries = useRef(0);
  const retryAuth = useCallback(() => {
    bootstrapRetries.current = 0;
    setClerkAttempt((attempt) => attempt + 1);
  }, []);
  const recoverBootstrap = useCallback((): boolean => {
    if (bootstrapRetries.current >= 2) return false;
    bootstrapRetries.current += 1;
    recordDiagnostic('clerk_bootstrap_retry', { attempt: bootstrapRetries.current });
    setClerkAttempt((attempt) => attempt + 1);
    return true;
  }, []);

  if (process.env.EXPO_PUBLIC_DEID_TEST_MODE === '1') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <DeidTestHarness />
      </SafeAreaProvider>
    );
  }

  return (
    <LanguageProvider>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <LanguageSetupGate>
          <DisclaimerGate>
            <ClerkProvider
              key={clerkAttempt}
              publishableKey={CLERK_PUBLISHABLE_KEY}
              proxyUrl={CLERK_PROXY_URL}
              tokenCache={clerkTokenCache}
              __experimental_resourceCache={clerkResourceCache}
            >
              <DemoVideoProvider>
                <AuthGate
                  onRetryAuth={retryAuth}
                  onBootstrapFailure={recoverBootstrap}
                >
                  <View className="flex-1 bg-white">
                    <TopBanners />
                    <ProcessingNotifications />
                    <SafeAreaProvider style={{ flex: 1 }}>
                      <Stack
                        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}
                      >
                        <Stack.Screen name="index" />
                        <Stack.Screen name="people" />
                        <Stack.Screen name="edit-user" options={{ animation: 'none', gestureEnabled: false }} />
                        <Stack.Screen name="tests" />
                        <Stack.Screen name="guests/index" />
                        <Stack.Screen name="guests/new" />
                        <Stack.Screen name="guests/[id]" />
                        <Stack.Screen name="test/[id]" />
                        <Stack.Screen name="record/[id]" options={{ gestureEnabled: false }} />
                        <Stack.Screen name="results/index" options={{ animation: 'none' }} />
                        <Stack.Screen name="results/[id]" />
                        <Stack.Screen name="results/test/[testId]" />
                        <Stack.Screen name="checkups/index" options={{ animation: 'none' }} />
                        <Stack.Screen name="checkups/[id]" />
                        <Stack.Screen name="shared/[id]" />
                        <Stack.Screen name="invite" />
                        <Stack.Screen name="share-code" />
                        <Stack.Screen name="about" options={{ presentation: 'card', animation: 'none' }} />
                      </Stack>
                      <ToastHost />
                    </SafeAreaProvider>
                  </View>
                </AuthGate>
              </DemoVideoProvider>
            </ClerkProvider>
          </DisclaimerGate>
        </LanguageSetupGate>
      </SafeAreaProvider>
    </LanguageProvider>
  );
}
