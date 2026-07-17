import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { useT } from '../lib/i18n';
import type { SharedRecording } from '../lib/sharedRecordings';
import { TESTS } from '../lib/tests';
import type { Recording } from '../lib/types';
import { TrendChart, type TrendPoint } from './TrendChart';

/**
 * Per-test score-over-time charts, one card per test that has at least one
 * finished recording, in TESTS order. Ported from the luche.ai observer
 * dashboard (TrialChart): x = time, y = 0–1 severity score, tap a point → that
 * recording's video/detail screen. Source is the LOCAL recordings list
 * (useRecordings) — no backend call (see plan's data-source decision).
 */
export function ResultsTrends({ recordings }: { recordings: Recording[] }) {
  const router = useRouter();
  const t = useT();

  // Only finished recordings carry a score to plot.
  const done = recordings.filter((r) => r.status === 'done' && r.result);
  if (done.length === 0) return null;

  const sections = TESTS.map((test) => {
    const points: TrendPoint[] = done
      .filter((r) => r.testId === test.id)
      .map((r) => ({ id: r.id, t: r.createdAt, score: r.result!.score }));
    return { test, points };
  }).filter((s) => s.points.length > 0);

  if (sections.length === 0) return null;

  return (
    <View className="gap-3 pb-4">
      <Text className="text-[16px] font-semibold text-ink">
        {t.resultsList.trendsTitle}
      </Text>

      {sections.map(({ test, points }) => (
        <View key={test.id} className="rounded-2xl border border-ink-faint bg-white p-4">
          <View className="mb-1 flex-row items-baseline justify-between">
            <Text className="text-[16px] font-semibold text-ink">{t.tests[test.id].name}</Text>
            <Text className="text-[14px] text-ink-muted">{t.tests[test.id].descriptor}</Text>
          </View>
          <TrendChart
            points={points}
            onPointPress={(id) => router.push({ pathname: '/results/[id]', params: { id } })}
          />
        </View>
      ))}
    </View>
  );
}

/** The same progress cards for a selected person sharing recordings remotely. */
export function SharedResultsTrends({
  recordings,
  ownerName,
}: {
  recordings: SharedRecording[];
  ownerName: string;
}) {
  const router = useRouter();
  const t = useT();

  const scored = recordings.filter(
    (recording): recording is SharedRecording & { score: number } => recording.score != null,
  );
  if (scored.length === 0) return null;

  const sections = [...new Set(scored.map((recording) => recording.testId))].map((testId) => {
    const matching = scored.filter((recording) => recording.testId === testId);
    const first = matching[0];
    return {
      testId,
      name: first.testName,
      descriptor: first.updrsItem || first.unit,
      points: matching.map((recording) => ({
        id: String(recording.trialId),
        t: recording.createdAt,
        score: recording.score,
      })),
    };
  });

  return (
    <View className="gap-3 pb-4">
      <Text className="text-[16px] font-semibold text-ink">
        {t.resultsList.personProgress(ownerName)}
      </Text>

      {sections.map((section) => (
        <View key={section.testId} className="rounded-2xl border border-ink-faint bg-white p-4">
          <View className="mb-1 flex-row items-baseline justify-between">
            <Text className="text-[16px] font-semibold text-ink">{section.name}</Text>
            <Text className="text-[14px] text-ink-muted">{section.descriptor}</Text>
          </View>
          <TrendChart
            points={section.points}
            onPointPress={(id) =>
              router.push({ pathname: '/shared/[id]', params: { id, ownerName } })
            }
          />
        </View>
      ))}
    </View>
  );
}
