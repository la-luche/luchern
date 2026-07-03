import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { localizeSeverity, useT } from '../lib/i18n';
import { getTest } from '../lib/tests';
import { COLORS } from '../lib/theme';
import type { Recording } from '../lib/types';
import { StatusPill } from './StatusPill';

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** A previous-recording card in the results list. */
export function RecordingCard({
  recording,
  onPress,
}: {
  recording: Recording;
  onPress: () => void;
}) {
  const t = useT();
  const test = getTest(recording.testId);
  const name = test ? t.tests[test.id].name : t.recordingCard.fallback;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t.recordingCard.a11y(name, formatDate(recording.createdAt))}
      className="flex-row items-center rounded-2xl border border-ink-faint bg-white p-4 active:opacity-70"
    >
      {/* Thumbnail placeholder — a real thumbnail lands with cloud/video work. */}
      <View className="h-14 w-14 items-center justify-center rounded-xl bg-ink">
        <MaterialCommunityIcons
          name={test?.icon ?? 'video'}
          size={26}
          color={COLORS.white}
        />
      </View>

      <View className="ml-4 flex-1 gap-1">
        <Text className="text-[16px] font-semibold text-ink">{name}</Text>
        <Text className="text-[12px] text-ink-muted">{formatDate(recording.createdAt)}</Text>
        <StatusPill status={recording.status} />
      </View>

      {recording.status === 'done' && recording.result && (
        <View className="items-end">
          <Text className="text-[20px] font-bold text-ink">
            {recording.result.score.toFixed(2)}
          </Text>
          <Text className="text-[11px] text-ink-muted">
            {localizeSeverity(t, recording.result.label)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
