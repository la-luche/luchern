import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { ResilientVideo } from '../../components/ResilientVideo';
import { Screen } from '../../components/Screen';
import { isConnectionFailure, showConnectionAlert } from '../../lib/connectivity';
import { localizeSeverity, useT } from '../../lib/i18n';
import {
  fetchSharedTrialDetail,
  type SharedTrialDetail,
} from '../../lib/sharedRecordings';
import { getTest } from '../../lib/tests';
import { METHODOLOGY_URL } from '../../lib/links';
import { COLORS } from '../../lib/theme';

function formatGrade(detail: SharedTrialDetail): string {
  const grade = detail.updrs_grade
    ?? (detail.score == null ? null : Math.min(4, Math.max(0, detail.score * 4)));
  return grade == null ? '—' : grade.toFixed(1);
}

/** Read-only detail for a trial owned by somebody sharing with this account. */
export default function SharedResultDetailScreen() {
  const { id, ownerName } = useLocalSearchParams<{ id: string; ownerName?: string }>();
  const t = useT();
  const trialId = Number(id);

  const [detail, setDetail] = useState<SharedTrialDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const loadRequest = useRef(0);
  const automaticVideoRetry = useRef(0);

  const load = useCallback(async () => {
    if (!Number.isInteger(trialId) || trialId <= 0) return;
    const request = ++loadRequest.current;
    setLoading(true);
    setError(false);
    try {
      const response = await fetchSharedTrialDetail(trialId);
      if (request !== loadRequest.current) return;
      setDetail(response);
    } catch (loadError) {
      if (request !== loadRequest.current) return;
      setDetail(null);
      setError(true);
      if (isConnectionFailure(loadError)) {
        showConnectionAlert(t, () => void load());
      }
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [t, trialId]);

  useEffect(() => {
    automaticVideoRetry.current = 0;
    void load();
    return () => {
      ++loadRequest.current;
    };
  }, [load]);

  const handlePlaybackError = useCallback(() => {
    if (automaticVideoRetry.current < 1) {
      automaticVideoRetry.current += 1;
      void load();
      return;
    }
    setError(true);
  }, [load]);

  const handlePlaybackReady = useCallback(() => {
    automaticVideoRetry.current = 0;
    setError(false);
  }, []);

  if (!Number.isInteger(trialId) || trialId <= 0) return <Redirect href="/results" />;

  const noScore =
    detail?.analysis_status === 'needs_retry'
    || detail?.analysis_status === 'failed'
    || detail?.scoreable === false;
  const hasScore = detail?.updrs_grade != null || detail?.score != null;
  const scoreLabel = detail?.updrs_label
    ? localizeSeverity(t, detail.updrs_label)
    : detail?.unit === '% fog'
      ? t.resultsList.fog
      : t.resultsList.severity;
  const localTest = getTest(detail?.test_type_id);

  return (
    <Screen>
      <Header
        title={localTest ? t.tests[localTest.id].name : detail?.display_name ?? t.result.fallbackTitle}
      />
      <ScrollView contentContainerClassName="px-6 pb-10">
        {!!ownerName && (
          <Text className="mb-3 text-center text-[14px] text-ink-muted">
            {t.resultsList.sharedBy(ownerName)}
          </Text>
        )}

        <View className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
          {detail ? (
            <ResilientVideo
              key={detail.video_url}
              uri={detail.video_url}
              onError={handlePlaybackError}
              onReady={handlePlaybackReady}
            />
          ) : (
            <View className="flex-1 items-center justify-center px-6">
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <MaterialCommunityIcons name="video-off-outline" size={44} color={COLORS.white} />
              )}
            </View>
          )}
        </View>

        {error ? (
          <View className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5">
            <Text className="text-[16px] font-semibold text-red-700">
              {t.resultsList.videoLoadFailed}
            </Text>
            <Text className="mt-1 text-[14px] leading-5 text-red-700">
              {t.resultsList.videoLoadFailedBody}
            </Text>
            <View className="mt-4">
              <Button title={t.resultsList.tryAgain} variant="secondary" onPress={() => void load()} />
            </View>
          </View>
        ) : detail ? (
          <>
            <View className="mt-4 rounded-2xl border border-ink-faint p-5">
              {noScore ? (
                <View className="mt-3">
                  <Text className="text-[16px] font-semibold text-red-700">
                    {t.result.noScoreTitle}
                  </Text>
                  <Text className="mt-1 text-[14px] leading-5 text-ink-muted">
                    {t.resultsList.sharedNoScoreBody}
                  </Text>
                </View>
              ) : !hasScore ? (
                <View className="mt-4 flex-row items-center gap-3">
                  <ActivityIndicator color={COLORS.ink} />
                  <Text className="text-[14px] text-ink-muted">{t.result.processing}</Text>
                </View>
              ) : (
                <View className="mt-3 items-center">
                  <Text className="text-[44px] font-bold text-ink">{formatGrade(detail)}</Text>
                  <Text className="text-[16px] font-medium text-ink-muted">
                    {t.result.gradeLabel(scoreLabel)}
                  </Text>
                  <Text className="mt-2 text-center text-[15px] leading-5 text-ink-muted">
                    {t.result.scoreHint}
                  </Text>
                  <View className="mt-4 w-full">
                    <Button
                      title={t.result.howScoreCalculated}
                      variant="secondary"
                      onPress={() => void Linking.openURL(METHODOLOGY_URL)}
                    />
                  </View>
                </View>
              )}
            </View>

            <View className="mt-4 rounded-2xl border border-ink-faint p-5">
              <Text className="text-[15px] font-semibold text-ink">{t.resultsList.recordingDetails}</Text>
              <View className="mt-3 gap-2">
                <Text className="text-[14px] text-ink-muted">
                  {t.resultsList.recorded}:{' '}
                  {new Date(detail.recorded_at).toLocaleString()}
                </Text>
                {detail.duration_seconds != null && (
                  <Text className="text-[14px] text-ink-muted">
                    {t.resultsList.duration}: {detail.duration_seconds.toFixed(1)} s
                  </Text>
                )}
                {detail.total_frames != null && (
                  <Text className="text-[14px] text-ink-muted">
                    {t.resultsList.frames}: {detail.total_frames}
                  </Text>
                )}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
