import { useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { TestRow } from '../components/TestRow';
import { useT } from '../lib/i18n';
import { endSession, startSession } from '../lib/session';
import { TESTS } from '../lib/tests';
import { COLORS } from '../lib/theme';

/** Menu: run-all session, the test rows, and previous recordings. */
export default function MenuScreen() {
  const router = useRouter();
  const t = useT();
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  const profileName = user?.fullName || user?.firstName || email || t.profile.account;

  const startFullCheck = () => {
    startSession(TESTS.map((test) => test.id));
    router.push({ pathname: '/test/[id]', params: { id: TESTS[0].id } });
  };

  const openSingle = (id: string) => {
    endSession(); // single-test taps run as one-offs, never part of a session
    router.push({ pathname: '/test/[id]', params: { id } });
  };

  return (
    <Screen>
      {/* The signed-in identity stays visible from the main screen. */}
      <View className="h-12 flex-row items-center justify-end px-[18px]">
        <Pressable
          onPress={() => router.push('/about')}
          accessibilityRole="button"
          accessibilityLabel={t.profile.openProfileA11y}
          className="h-11 max-w-[240px] flex-row items-center gap-2 rounded-full bg-ink-faint px-2.5 pr-4 active:opacity-70"
        >
          {user?.imageUrl ? (
            <Image
              source={{ uri: user.imageUrl }}
              className="h-7 w-7 rounded-full"
              contentFit="cover"
            />
          ) : (
            <View className="h-7 w-7 items-center justify-center rounded-full bg-white">
              <Ionicons name="person-outline" size={17} color={COLORS.ink} />
            </View>
          )}
          <Text numberOfLines={1} className="shrink text-[15px] font-medium text-ink">
            {profileName}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="px-6 pb-8">
        {/* Title block. */}
        <View className="items-center pt-3">
          <Text className="text-[28px] font-bold text-ink">{t.common.appName}</Text>
        </View>

        {/* Run-all session. */}
        <View className="mt-6">
          <Button title={t.menu.startFullCheck} onPress={startFullCheck} />
          <Text className="mt-2 text-center text-[13px] text-ink-muted">
            {t.menu.orSingle}
          </Text>
        </View>

        {/* Test rows. */}
        <View className="mt-4 gap-3.5">
          {TESTS.map((test) => (
            <TestRow key={test.id} test={test} onPress={() => openSingle(test.id)} />
          ))}
        </View>

        {/* Previous recordings. */}
        <View className="mt-8">
          <Button
            title={t.menu.previousRecordings}
            variant="secondary"
            onPress={() => router.push('/results')}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
