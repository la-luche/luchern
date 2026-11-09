import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { formatCheckupScore, type Checkup } from '../lib/checkups';
import { useT } from '../lib/i18n';
import { COLORS } from '../lib/theme';

export function CheckupCard({ checkup, onPress }: { checkup: Checkup; onPress: () => void }) {
  const t = useT();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="mb-3 flex-row items-center gap-4 rounded-2xl bg-ink-faint p-5 active:opacity-70">
      <View className="flex-1 gap-1">
        <Text className="text-[21px] font-semibold text-ink">{t.checkups.title}</Text>
        <Text className="text-[15px] text-ink-muted">{new Date(checkup.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
        <Text className="text-[14px] text-ink-muted">{t.checkups.available(checkup.overall.count, checkup.expectedSteps)}</Text>
      </View>
      <View className="items-end">
        <Text className="text-[32px] font-semibold text-ink">{formatCheckupScore(checkup.overall.value)}</Text>
        <Text className="text-[14px] text-ink-muted">{t.checkups.outOfFour}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={COLORS.ink} />
    </Pressable>
  );
}
