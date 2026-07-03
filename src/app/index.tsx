import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { TestRow } from '../components/TestRow';
import { TESTS } from '../lib/tests';
import { COLORS } from '../lib/theme';

/** Menu: title + the four test rows + navigation to previous recordings. */
export default function MenuScreen() {
  const router = useRouter();

  return (
    <Screen>
      {/* Top bar — About/info button only. */}
      <View className="h-12 flex-row items-center justify-end px-[18px]">
        <Pressable
          onPress={() => router.push('/about')}
          accessibilityRole="button"
          accessibilityLabel="About and privacy"
          className="h-9 w-9 items-center justify-center rounded-full bg-ink-faint active:opacity-70"
        >
          <Ionicons name="information" size={18} color={COLORS.ink} />
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="px-6 pb-8">
        {/* Title block. */}
        <View className="items-center pt-3">
          <Text className="text-[28px] font-bold text-ink">Luche</Text>
          <Text className="mt-1 text-[15px] font-medium text-ink-muted">Choose a test</Text>
        </View>

        {/* Test rows. */}
        <View className="mt-6 gap-3.5">
          {TESTS.map((test) => (
            <TestRow
              key={test.id}
              test={test}
              onPress={() => router.push({ pathname: '/test/[id]', params: { id: test.id } })}
            />
          ))}
        </View>

        {/* Previous recordings. */}
        <View className="mt-8">
          <Button
            title="Previous recordings"
            variant="secondary"
            onPress={() => router.push('/results')}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
