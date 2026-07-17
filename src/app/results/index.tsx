import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Share, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { RecordingCard } from '../../components/RecordingCard';
import { ResultsTrends } from '../../components/ResultsTrends';
import { Screen } from '../../components/Screen';
import { localizeSeverity, useT } from '../../lib/i18n';
import { useRecordings } from '../../lib/storage';
import { COLORS } from '../../lib/theme';

/** List of previous recordings as cards, newest first, + share-summary. */
export default function ResultsScreen() {
  const router = useRouter();
  const { recordings, loading } = useRecordings();
  const t = useT();

  const done = recordings.filter((r) => r.status === 'done' && r.result);

  // A plain-text recap of finished tests, shared via the OS share sheet
  // (email / WhatsApp / …) so a patient can send results to their doctor.
  const shareSummary = async () => {
    const lines = done.map((r) => {
      const name = t.tests[r.testId]?.name ?? t.recordingCard.fallback;
      const date = new Date(r.createdAt).toLocaleDateString();
      const label = localizeSeverity(t, r.result!.label);
      const val =
        r.result!.updrsGrade != null
          ? ` (${r.result!.updrsGrade})`
          : r.result!.score != null
            ? ` (${r.result!.score.toFixed(2)})`
            : '';
      return `• ${name} — ${date} — ${label}${val}`;
    });
    const message = [t.share.summaryHeader, '', ...lines, '', t.share.summaryFooter].join('\n');
    try {
      await Share.share({ message });
    } catch {
      // user dismissed the sheet — nothing to do
    }
  };

  return (
    <Screen>
      <Header title={t.resultsList.title} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={COLORS.ink} />
        </View>
      ) : recordings.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10">
          <MaterialCommunityIcons name="video-off-outline" size={52} color={COLORS.inkFaint} />
          <Text className="mt-4 text-center text-[17px] font-semibold text-ink">
            {t.resultsList.emptyTitle}
          </Text>
          <Text className="mt-1 text-center text-[14px] text-ink-muted">
            {t.resultsList.emptyBody}
          </Text>
        </View>
      ) : (
        <FlatList
          data={recordings}
          keyExtractor={(r) => r.id}
          contentContainerClassName="px-6 pb-8 gap-3"
          ListHeaderComponent={
            <View>
              {done.length > 0 && (
                <View className="pb-4">
                  <Button
                    title={t.share.shareResults}
                    variant="secondary"
                    onPress={shareSummary}
                  />
                </View>
              )}
              <ResultsTrends recordings={recordings} />
            </View>
          }
          renderItem={({ item }) => (
            <RecordingCard
              recording={item}
              onPress={() => router.push({ pathname: '/results/[id]', params: { id: item.id } })}
            />
          )}
        />
      )}
    </Screen>
  );
}
