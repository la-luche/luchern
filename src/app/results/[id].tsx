import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { ResilientVideo } from '../../components/ResilientVideo';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import {
  formatAnalysisFailureReason,
  formatEvaluatedSide,
  localizeSeverity,
  useT,
} from '../../lib/i18n';
import { METHODOLOGY_URL } from '../../lib/links';
import { fetchSharedTrialDetail } from '../../lib/sharedRecordings';
import { useRecordings } from '../../lib/storage';
import { getTest } from '../../lib/tests';
import { COLORS } from '../../lib/theme';

/** Detail for one recording: retained local playback or cloud playback on demand. */
export default function ResultDetailScreen() {
  const { id, guestId } = useLocalSearchParams<{ id: string; guestId?: string }>();
  const router = useRouter();
  const {
    recordings,
    loading,
    remove,
    retry,
    retryPrivacyBlurring,
    uploadWithoutPrivacyBlurring,
  } = useRecordings({ guestId });
  const recording = recordings.find((r) => r.id === id);
  const t = useT();
  const [remoteVideoUri, setRemoteVideoUri] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const automaticVideoRetry = useRef(0);

  const loadRemoteVideo = useCallback(async () => {
    if (!recording?.jobId) {
      setVideoError(true);
      return null;
    }
    setVideoLoading(true);
    setVideoError(false);
    try {
      const detail = await fetchSharedTrialDetail(Number(recording.jobId));
      setRemoteVideoUri(detail.video_url);
      return detail.video_url;
    } catch {
      setRemoteVideoUri(null);
      setVideoError(true);
      return null;
    } finally {
      setVideoLoading(false);
    }
  }, [recording?.jobId]);

  useEffect(() => {
    automaticVideoRetry.current = 0;
    setRemoteVideoUri(null);
    setVideoError(false);
    if (recording && !recording.videoUri) void loadRemoteVideo();
  }, [loadRemoteVideo, recording?.id, recording?.videoUri]);

  const handlePlaybackError = useCallback(() => {
    if (!recording?.videoUri && automaticVideoRetry.current < 1) {
      automaticVideoRetry.current += 1;
      void loadRemoteVideo();
      return;
    }
    setVideoError(true);
  }, [loadRemoteVideo, recording?.videoUri]);

  const handlePlaybackReady = useCallback(() => {
    automaticVideoRetry.current = 0;
    setVideoError(false);
  }, []);

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

  if (!recording) {
    return guestId ? (
      <Redirect href={{ pathname: '/guests/[id]', params: { id: guestId } }} />
    ) : (
      <Redirect href="/results" />
    );
  }

  const leaveResult = () => {
    if (guestId) {
      router.dismissTo({ pathname: '/guests/[id]', params: { id: guestId } });
    } else {
      router.navigate('/');
    }
  };

  const test = getTest(recording.testId);
  const sideLabel = test ? formatEvaluatedSide(t, test, recording.evaluatedSide) : undefined;
  const privacyPending = Boolean(
    (recording.faceBlurRequested || recording.backgroundBlurRequested) &&
      recording.privacyBlurState !== 'completed' &&
      recording.privacyBlurState !== 'bypassed',
  );

  const shareVideo = async () => {
    if (privacyPending) return;
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert(t.result.sharingUnavailableTitle, t.result.sharingUnavailableBody);
      return;
    }
    try {
      // Copy to a doctor-friendly filename (test + date) so the shared clip is
      // self-explanatory, then open the share sheet (email, WhatsApp, AirDrop…).
      const baseName = test ? t.tests[test.id].name : t.result.fallbackTitle;
      const name = sideLabel ? `${baseName}_${sideLabel}` : baseName;
      const date = new Date(recording.createdAt).toISOString().slice(0, 10);
      const safe = `Luche_${name}_${date}`.replace(/[^\w-]+/g, '_');
      let uri = recording.videoUri ?? remoteVideoUri ?? (await loadRemoteVideo());
      if (!uri) throw new Error(t.resultsList.videoLoadFailed);
      if (FileSystem.cacheDirectory) {
        const dest = `${FileSystem.cacheDirectory}${safe}.mp4`;
        try {
          await FileSystem.deleteAsync(dest, { idempotent: true });
          if (uri.startsWith('file://')) {
            await FileSystem.copyAsync({ from: uri, to: dest });
          } else {
            await FileSystem.downloadAsync(uri, dest);
          }
          uri = dest;
        } catch {
          // A remote URL cannot be handed reliably to the native share sheet.
          if (!uri.startsWith('file://')) throw new Error(t.result.couldNotShare);
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
            leaveResult();
          } catch {
            Alert.alert(t.result.deleteFailedTitle, t.result.deleteFailedBody);
          }
        },
      },
    ]);
  };

  const confirmUnblurredUpload = () => {
    Alert.alert(
      t.result.sendWithoutPrivacyBlurConfirmTitle,
      t.result.sendWithoutPrivacyBlurConfirmBody,
      [
        { text: t.common.cancel, style: 'cancel' },
        {
          text: t.result.sendWithoutPrivacyBlur,
          style: 'destructive',
          onPress: () => uploadWithoutPrivacyBlurring(recording.id),
        },
      ],
    );
  };

  return (
    <Screen>
      <Header
        title={test ? t.tests[test.id].name : t.result.fallbackTitle}
        onBack={guestId ? leaveResult : undefined}
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
        {sideLabel ? (
          <View className="mb-3 self-start rounded-full bg-ink-faint px-4 py-2">
            <Text className="text-[14px] font-semibold text-ink">{sideLabel}</Text>
          </View>
        ) : null}

        {/* Video playback. */}
        <View className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
          {recording.videoUri || remoteVideoUri ? (
            <ResilientVideo
              key={recording.videoUri ?? remoteVideoUri}
              uri={recording.videoUri ?? remoteVideoUri!}
              onError={handlePlaybackError}
              onReady={handlePlaybackReady}
            />
          ) : (
            <View className="flex-1 items-center justify-center px-6">
              {videoLoading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <MaterialCommunityIcons name="video-off-outline" size={44} color={COLORS.white} />
              )}
            </View>
          )}
        </View>

        {videoError && (
          <View className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
            <Text className="text-[15px] font-semibold text-red-700">
              {t.resultsList.videoLoadFailed}
            </Text>
            <View className="mt-3">
              <Button
                title={t.resultsList.tryAgain}
                variant="secondary"
                onPress={() => void loadRemoteVideo()}
              />
            </View>
          </View>
        )}

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
              <View className="mt-4 w-full">
                <Button
                  title={t.result.howScoreCalculated}
                  variant="secondary"
                  onPress={() => void Linking.openURL(METHODOLOGY_URL)}
                />
              </View>
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
          ) : recording.status === 'blur_failed' ? (
            <View className="mt-3 gap-3">
              <Text className="text-[15px] font-semibold text-red-700">
                {t.result.privacyBlurFailedTitle}
              </Text>
              <Text className="text-[14px] leading-5 text-ink-muted">
                {t.result.privacyBlurFailedBody}
              </Text>
              <Button
                title={t.result.retryPrivacyBlur}
                onPress={() => retryPrivacyBlurring(recording.id)}
              />
              <Button
                title={t.result.sendWithoutPrivacyBlur}
                variant="secondary"
                onPress={confirmUnblurredUpload}
              />
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
              <View className="flex-1">
                <Text className="text-[14px] text-ink-muted">
                  {recording.status === 'uploading'
                    ? recording.uploadRetrying
                      ? `${t.uploadBanner.retrying} · ${t.uploadBanner.attempt(recording.uploadAttempt ?? 2)}`
                      : t.result.uploading
                    : recording.status === 'preparing'
                      ? `${t.result.privacyBlurring} · ${Math.round((recording.privacyBlurProgress ?? 0) * 100)}%`
                      : t.result.processing}
                </Text>
                {recording.status === 'preparing' && (
                  <Text className="mt-1 text-[14px] leading-5 text-ink-muted">
                    {t.result.uploadStartsAfterPrivacyBlur}
                  </Text>
                )}
                {recording.status === 'processing' && (
                  <Text className="mt-1 text-[14px] leading-5 text-ink-muted">
                    {t.result.processingWait}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>

        <View className="mt-8">
          <Button
            title={t.result.shareWithDoctor}
            variant="secondary"
            onPress={shareVideo}
            disabled={videoLoading || privacyPending}
          />
          <View className="mt-3">
            <Button
              title={guestId ? t.result.backToGuest : t.result.backToMenu}
              onPress={leaveResult}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
