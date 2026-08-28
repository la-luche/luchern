import { useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useT } from '../lib/i18n';
import { startSession } from '../lib/session';
import { FULL_TEST_FLOW } from '../lib/tests';
import { COLORS } from '../lib/theme';

/** Decluttered top-level menu: all movements, one movement, guests, history. */
export default function MenuScreen() {
  const router = useRouter();
  const t = useT();
  const { user } = useUser();

  const startFullCheck = () => {
    startSession(FULL_TEST_FLOW);
    router.push({ pathname: '/prepare', params: { mode: 'full' } });
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
            {t.profile.myAccount}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="px-6 pb-8">
        {/* Title block. */}
        <View className="items-center pt-3">
          <Text className="text-[28px] font-bold text-ink">{t.common.appName}</Text>
        </View>

        {/* The three recording entry points deliberately share one treatment. */}
        <View className="mt-6 gap-3">
          <Button title={t.menu.startFullCheck} onPress={startFullCheck} />
          <Button title={t.menu.recordOne} onPress={() => router.push('/tests')} />
          <Button title={t.menu.guests} onPress={() => router.push('/guests')} />
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
