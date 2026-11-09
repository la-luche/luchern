import { Text, View } from 'react-native';
import { checkupTrendPoints, type Checkup } from '../lib/checkups';
import { useT } from '../lib/i18n';
import { TrendChart } from './TrendChart';

export function CheckupHistoryChart({ checkups, onPointPress }: {
  checkups: Checkup[];
  onPointPress: (id: string) => void;
}) {
  const t = useT();
  if (checkups.length === 0) return null;
  const points = checkupTrendPoints(checkups);
  return (
    <View className="rounded-2xl border border-ink-faint bg-white p-4">
      <Text className="mb-3 text-[26px] font-semibold leading-[32px] text-ink">{t.checkups.overall}</Text>
      {points.length ? <TrendChart points={points} maxScore={4} onPointPress={onPointPress} /> : (
        <View className="h-[180px] items-center justify-center">
          <Text className="text-center text-[16px] text-ink-muted">{t.checkups.noScore}</Text>
        </View>
      )}
    </View>
  );
}
