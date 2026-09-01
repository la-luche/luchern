import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useT } from '../lib/i18n';
import { COLORS } from '../lib/theme';

/**
 * Minimal top bar: a circular back chevron (Luche style), an optional centered
 * title, and an optional right-side slot. Most screens pop the stack; a flow
 * may provide an explicit destination when its completion semantics require it.
 */
export function Header({
  title,
  right,
  onBack,
}: {
  title?: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const router = useRouter();
  const t = useT();
  return (
    <View className="min-h-[76px] flex-row items-center gap-3 px-5 py-3">
      <View className="w-12">
        <Pressable
          onPress={onBack ?? (() => router.back())}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          className="h-12 w-12 items-center justify-center rounded-full bg-ink-faint active:opacity-70"
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.ink} />
        </Pressable>
      </View>

      {title ? (
        <Text
          numberOfLines={2}
          style={{ textAlign: 'center' }}
          className="flex-1 text-[17px] font-semibold leading-[21px] text-ink"
        >
          {title}
        </Text>
      ) : (
        <View className="flex-1" />
      )}

      <View className="w-12 items-end">{right}</View>
    </View>
  );
}
