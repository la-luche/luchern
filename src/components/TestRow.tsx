import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { COLORS } from '../lib/theme';
import type { TestConfig } from '../lib/tests';

/** A single test row on the menu: ink icon tile + name + UPDRS item + chevron. */
export function TestRow({ test, onPress }: { test: TestConfig; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Start ${test.displayName} test`}
      className="flex-row items-center rounded-2xl bg-ink-faint px-[18px] py-[14px] active:opacity-70"
    >
      <View className="h-11 w-11 items-center justify-center rounded-xl bg-ink">
        <MaterialCommunityIcons name={test.icon} size={22} color={COLORS.white} />
      </View>

      <View className="ml-4 flex-1">
        <Text className="text-[18px] font-semibold text-ink">{test.displayName}</Text>
        <Text className="text-[12px] text-ink-muted">{test.updrsItem}</Text>
      </View>

      <Ionicons name="chevron-forward" size={16} color={COLORS.inkFaint} />
    </Pressable>
  );
}
