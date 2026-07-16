import { Ionicons } from '@expo/vector-icons';
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
      {/* Top bar — About/info button only. */}
      <View className="h-12 flex-row items-center justify-end px-[18px]">
        <Pressable
          onPress={() => router.push('/about')}
          accessibilityRole="button"
          accessibilityLabel={t.menu.aboutA11y}
          className="h-11 flex-row items-center gap-1.5 rounded-full bg-ink-faint px-4 active:opacity-70"
        >
          <Ionicons name="information-circle-outline" size={20} color={COLORS.ink} />
          <Text className="text-[16px] font-medium text-ink">{t.about.title}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="px-6 pb-8">
        {/* Title block. */}
        <View className="items-center pt-3">
          <Text className="text-[28px] font-bold text-ink">{t.common.appName}</Text>
          <Text className="mt-1 text-[15px] font-medium text-ink-muted">{t.menu.chooseTest}</Text>
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
