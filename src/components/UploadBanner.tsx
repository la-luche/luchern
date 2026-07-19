import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../lib/i18n';
import { useRecordings } from '../lib/storage';
import { uploadingCount } from '../lib/uploadRetry';

/**
 * Top status banner. While ≥1 recording is uploading it shows progress; when
 * uploads have failed (and are retryable) it offers a one-tap "Retry all".
 * Participates in the root layout so it never covers navigation or screen UI.
 */
export function UploadBanner() {
  const { recordings, retry } = useRecordings();
  const insets = useSafeAreaInsets();
  const t = useT();
  const n = uploadingCount(recordings);

  const preparing = recordings.filter((recording) => recording.status === 'preparing');
  useEffect(() => {
    const tag = 'luche-face-blur';
    if (preparing.length > 0) {
      void activateKeepAwakeAsync(tag);
      return () => {
        void deactivateKeepAwake(tag);
      };
    }
    return undefined;
  }, [preparing.length]);

  if (preparing.length > 0) {
    const progress = Math.round(
      (preparing.reduce((sum, recording) => sum + (recording.faceBlurProgress ?? 0), 0) /
        preparing.length) *
        100,
    );
    return (
      <View pointerEvents="none" style={{ paddingTop: insets.top }} className="bg-violet-600">
        <Text className="px-4 pb-2 pt-1 text-center text-[13px] font-semibold text-white">
          {t.uploadBanner.faceBlurring(preparing.length)} · {progress}%
        </Text>
      </View>
    );
  }

  if (n > 0) {
    const uploading = recordings.filter((r) => r.status === 'uploading');
    const attempt = Math.max(...uploading.map((r) => r.uploadAttempt ?? 1));
    const retrying = uploading.some((r) => r.uploadRetrying);
    const progress = uploading.length
      ? Math.round(
          (uploading.reduce((sum, r) => sum + (r.uploadProgress ?? 0), 0) / uploading.length) * 100,
        )
      : null;
    const stateColor = retrying ? 'bg-red-600' : attempt > 1 ? 'bg-amber-500' : 'bg-blue-600';
    return (
      <View pointerEvents="none" style={{ paddingTop: insets.top }} className={stateColor}>
        <Text className="px-4 pb-2 pt-1 text-center text-[13px] font-semibold text-white">
          {retrying ? t.uploadBanner.retrying : t.uploadBanner.keepOpen(n)}
          {attempt > 1 ? ` · ${t.uploadBanner.attempt(attempt)}` : ''}
          {progress != null ? ` · ${progress}%` : ''}
        </Text>
      </View>
    );
  }

  // Failed but not permanent → let the user retry them all at once.
  const failed = recordings.filter(
    (recording) => recording.status === 'failed' && recording.resumable && !recording.permanent,
  );
  if (failed.length > 0) {
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-row items-center justify-between bg-red-600 px-4 pb-2 pt-1"
      >
        <Text className="flex-1 text-[13px] font-semibold text-white">
          {t.uploadBanner.failed(failed.length)}
        </Text>
        <Pressable
          onPress={() => failed.forEach((r) => retry(r.id))}
          accessibilityRole="button"
          accessibilityLabel={t.uploadBanner.retryAll}
          className="ml-3 rounded-full bg-white/25 px-3 py-1 active:opacity-70"
        >
          <Text className="text-[13px] font-bold text-white">{t.uploadBanner.retryAll}</Text>
        </Pressable>
      </View>
    );
  }

  const blurFailed = recordings.filter((recording) => recording.status === 'blur_failed');
  if (blurFailed.length > 0) {
    return (
      <View pointerEvents="none" style={{ paddingTop: insets.top }} className="bg-red-600">
        <Text className="px-4 pb-2 pt-1 text-center text-[13px] font-semibold text-white">
          {t.uploadBanner.faceBlurFailed(blurFailed.length)}
        </Text>
      </View>
    );
  }

  return null;
}
