import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useT } from '../lib/i18n';
import type { SharedRecording } from '../lib/sharedRecordings';
import { getTest } from '../lib/tests';
import { COLORS } from '../lib/theme';

function formatDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Read-only card for a recording another account shared with this user. */
export function SharedRecordingCard({
  recording,
  onPress,
}: {
  recording: SharedRecording;
  onPress: () => void;
}) {
  const t = useT();
  const localTest = getTest(recording.testId);
  const name = localTest ? t.tests[localTest.id].name : recording.testName;
  const date = formatDate(recording.createdAt);
  const grade = recording.score == null
    ? null
    : Math.min(4, Math.max(0, recording.score * 4));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t.recordingCard.a11y(name, date)}
      className="mb-3 flex-row items-center rounded-2xl border border-ink-faint bg-white p-4 active:opacity-70"
    >
      <View className="h-14 w-14 items-center justify-center rounded-xl bg-ink">
        <MaterialCommunityIcons
          name={localTest?.icon ?? 'video'}
          size={26}
          color={COLORS.white}
        />
      </View>

      <View className="ml-4 flex-1 gap-1">
        <Text className="text-[17px] font-semibold text-ink">{name}</Text>
        <Text className="text-[15px] text-ink-muted">{date}</Text>
      </View>

      {grade == null ? (
        <View className="items-end gap-1">
          <ActivityIndicator size="small" color={COLORS.inkMuted} />
          <Text className="text-[12px] text-ink-muted">{t.resultsList.scorePending}</Text>
        </View>
      ) : (
        <Text className="text-[20px] font-bold text-ink">{grade.toFixed(1)}</Text>
      )}
    </Pressable>
  );
}
