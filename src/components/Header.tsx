import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useT } from '../lib/i18n';
import { COLORS } from '../lib/theme';

/**
 * Minimal top bar: a circular back chevron (Luche style), an optional centered
 * title, and an optional right-side slot. Always pops the stack — every screen
 * that uses it is pushed onto one.
 */
export function Header({ title, right }: { title?: string; right?: ReactNode }) {
  const router = useRouter();
  const t = useT();
  return (
    <View className="h-12 flex-row items-center justify-between px-[18px]">
      <View className="w-10">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          className="h-11 w-11 items-center justify-center rounded-full bg-ink-faint active:opacity-70"
        >
          <Ionicons name="chevron-back" size={22} color={COLORS.ink} />
        </Pressable>
      </View>

      {title ? (
        <Text className="text-[16px] font-semibold text-ink">{title}</Text>
      ) : (
        <View />
      )}

      <View className="w-10 items-end">{right}</View>
    </View>
  );
}
