import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { useT } from '../lib/i18n';
import { getTest } from '../lib/tests';
import { COLORS } from '../lib/theme';
import { TrendChart, type TrendPoint } from './TrendChart';

/** In the overview the whole chart opens its test type; within that type, dots open recordings. */
export function TestHistoryChart({ testId, fallbackName, points, onPress, onPointPress }: {
  testId: string;
  fallbackName?: string;
  points: TrendPoint[];
  onPress?: () => void;
  onPointPress?: (id: string) => void;
}) {
  const t = useT();
  const test = getTest(testId);
  const name = test ? t.tests[test.id].name : fallbackName || t.recordingCard.fallback;
  const content = <>
    <View className="mb-3 flex-row items-center gap-3">
      <Text className="flex-1 text-[26px] font-semibold leading-[32px] text-ink">{name}</Text>
      {onPress && <Ionicons name="chevron-forward" size={24} color={COLORS.ink} />}
    </View>
    <View pointerEvents={onPress ? 'none' : 'auto'}>
      {points.length ? <TrendChart points={points} onPointPress={onPress ? undefined : onPointPress} /> : (
        <View className="h-[180px] items-center justify-center">
          <Text className="text-center text-[16px] text-ink-muted">{t.checkups.noScore}</Text>
        </View>
      )}
    </View>
  </>;
  const className = 'mb-4 rounded-2xl border border-ink-faint bg-white p-4';
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={onPress} className={`${className} active:opacity-70`}>
      {content}
    </Pressable>
  ) : <View className={className}>{content}</View>;
}
