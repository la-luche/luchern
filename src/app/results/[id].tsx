import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { formatAnalysisFailureReason, localizeSeverity, useT } from '../../lib/i18n';
import { useRecordings } from '../../lib/storage';
import { getTest } from '../../lib/tests';
import { COLORS } from '../../lib/theme';

/** Detail for one recording: video playback + experimental cloud-analysis panel. */
export default function ResultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { recordings, loading, remove, retry } = useRecordings();
  const recording = recordings.find((r) => r.id === id);
  const t = useT();

  // Hook must run unconditionally — source is null until the recording loads.
  const player = useVideoPlayer(recording ? { uri: recording.videoUri } : null, (p) => {
    p.loop = true;
  });

  if (loading) {
    return (
      <Screen>
        <Header title={t.result.fallbackTitle} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={COLORS.ink} />
        </View>
      </Screen>
    );
  }

  if (!recording) return <Redirect href="/results" />;

  const test = getTest(recording.testId);

  const shareVideo = async () => {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert(t.result.sharingUnavailableTitle, t.result.sharingUnavailableBody);
      return;
    }
    try {
      // Copy to a doctor-friendly filename (test + date) so the shared clip is
      // self-explanatory, then open the share sheet (email, WhatsApp, AirDrop…).
      const name = test ? t.tests[test.id].name : t.result.fallbackTitle;
      const date = new Date(recording.createdAt).toISOString().slice(0, 10);
      const safe = `Luche_${name}_${date}`.replace(/[^\w-]+/g, '_');
      let uri = recording.videoUri;
      if (FileSystem.cacheDirectory) {
        const dest = `${FileSystem.cacheDirectory}${safe}.mp4`;
        try {
          await FileSystem.copyAsync({ from: recording.videoUri, to: dest });
          uri = dest;
        } catch {
          // fall back to the original file if the copy fails
        }
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'video/mp4',
        dialogTitle: t.result.shareWithDoctor,
        UTI: 'public.movie',
      });
    } catch (e) {
      Alert.alert(t.result.couldNotShare, String(e));
    }
  };

  const confirmDelete = () => {
    Alert.alert(t.result.deleteTitle, t.result.deleteBody, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.common.delete,
        style: 'destructive',
        onPress: async () => {
          try {
            await remove(recording.id);
            router.back();
          } catch {
            Alert.alert(t.result.deleteFailedTitle, t.result.deleteFailedBody);
          }
        },
      },
    ]);
  };

  return (
    <Screen>
      <Header
        title={test ? t.tests[test.id].name : t.result.fallbackTitle}
        right={
          <Pressable
            onPress={confirmDelete}
            accessibilityRole="button"
            accessibilityLabel={t.result.deleteA11y}
            className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
          >
            <Ionicons name="trash-outline" size={20} color={COLORS.inkMuted} />
          </Pressable>
        }
      />

      <ScrollView contentContainerClassName="px-6 pb-10">
        {/* Video playback. */}
        <View className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
          <VideoView
            player={player}
            style={{ flex: 1 }}
            nativeControls
            contentFit="contain"
          />
        </View>

        <View className="mt-4">
          <StatusPill status={recording.status} />
        </View>

        {/* Experimental cloud analysis panel. */}
        <View className="mt-4 rounded-2xl border border-ink-faint p-5">
          <View className="flex-row items-center gap-2">
            <MaterialCommunityIcons name="cloud-outline" size={18} color={COLORS.ink} />
            <Text className="text-[15px] font-semibold text-ink">{t.result.cloudAnalysis}</Text>
          </View>

          {recording.status === 'done' && recording.result ? (
            <View className="mt-4 items-center">
              <Text className="text-[44px] font-bold text-ink">
                {recording.result.updrsGrade != null
                  ? recording.result.updrsGrade.toFixed(1)
                  : recording.result.score.toFixed(2)}
              </Text>
              <Text className="text-[16px] font-medium text-ink-muted">
                {recording.result.updrsGrade != null
                  ? t.result.gradeLabel(localizeSeverity(t, recording.result.label))
                  : localizeSeverity(t, recording.result.label)}
              </Text>
              <Text className="mt-2 text-center text-[15px] leading-5 text-ink-muted">
                {t.result.scoreHint}
              </Text>
              {recording.result.isDemo && (
                <View className="mt-3 rounded-xl bg-amber-100 px-3 py-1.5">
                  <Text className="text-center text-[14px] font-semibold text-amber-700">
                    {t.result.samplePill}
                  </Text>
                </View>
              )}
            </View>
          ) : recording.status === 'needs_retry' ? (
            <View className="mt-3 gap-2">
              <Text className="text-[15px] font-semibold text-red-700">
                {t.result.noScoreTitle}
              </Text>
              <Text className="text-[14px] leading-5 text-ink-muted">
                {t.result.noScoreBody}
              </Text>
              {(recording.analysisFailureReasons ?? []).map((reason) => (
                <View key={reason} className="flex-row gap-2">
                  <Text className="text-[14px] text-red-700">•</Text>
                  <Text selectable className="flex-1 text-[14px] leading-5 text-red-700">
                    {formatAnalysisFailureReason(reason)}
                  </Text>
                </View>
              ))}
            </View>
          ) : recording.status === 'failed' ? (
            <View className="mt-3 gap-3">
              <Text className="text-[14px] text-red-600">
                {recording.permanent
                  ? t.result.permanentFailed
                  : recording.resumable
                    ? t.result.failedRetry
                    : t.result.analysisFailed}
              </Text>
              {recording.resumable && (
                <Button title={t.result.retry} variant="secondary" onPress={() => retry(recording.id)} />
              )}
            </View>
          ) : (
            <View className="mt-4 flex-row items-center gap-3">
              <ActivityIndicator color={COLORS.ink} />
              <Text className="text-[14px] text-ink-muted">
                {recording.status === 'uploading'
                  ? recording.uploadRetrying
                    ? `${t.uploadBanner.retrying} · ${t.uploadBanner.attempt(recording.uploadAttempt ?? 2)}`
                    : t.result.uploading
                  : t.result.processing}
              </Text>
            </View>
          )}
        </View>

        <View className="mt-8">
          <Button title={t.result.shareWithDoctor} variant="secondary" onPress={shareVideo} />
          <View className="mt-3">
            <Button title={t.result.backToMenu} onPress={() => router.navigate('/')} />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
