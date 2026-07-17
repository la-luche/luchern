import { ClerkProvider } from '@clerk/clerk-expo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';
import { AuthGate } from '../components/AuthGate';
import { DisclaimerGate } from '../components/DisclaimerGate';
import { OfflineBanner } from '../components/OfflineBanner';
import { UploadBanner } from '../components/UploadBanner';
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
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={clerkTokenCache}>
      <LanguageProvider>
        <SafeAreaProvider>
        <StatusBar style="dark" />
        <DisclaimerGate>
          <AuthGate>
            <View className="flex-1 bg-white">
              <OfflineBanner />
              <UploadBanner />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="test/[id]" />
                <Stack.Screen name="record/[id]" options={{ gestureEnabled: false }} />
                <Stack.Screen name="results/index" />
                <Stack.Screen name="results/[id]" />
                <Stack.Screen name="invite" />
                <Stack.Screen name="share-code" />
                <Stack.Screen name="about" options={{ presentation: 'modal' }} />
              </Stack>
              <ToastHost />
            </View>
          </AuthGate>
        </DisclaimerGate>
        </SafeAreaProvider>
      </LanguageProvider>
    </ClerkProvider>
  );
}
