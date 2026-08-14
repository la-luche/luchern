import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
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
export function UploadBanner({ includeTopInset = true }: { includeTopInset?: boolean }) {
  const { recordings, retry } = useRecordings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const n = uploadingCount(recordings);
  const topInset = includeTopInset ? insets.top : 0;
  const openRecordings = (items: { id: string }[]) => {
    if (items.length === 1) {
      router.push({ pathname: '/results/[id]', params: { id: items[0].id } });
    } else {
      router.push('/results');
    }
  };

  const preparing = recordings.filter((recording) => recording.status === 'preparing');
  useEffect(() => {
    const tag = 'luche-privacy-blur';
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
      (preparing.reduce((sum, recording) => sum + (recording.privacyBlurProgress ?? 0), 0) /
        preparing.length) *
        100,
    );
    return (
      <Pressable
        onPress={() => openRecordings(preparing)}
        accessibilityRole="button"
        style={{ paddingTop: topInset }}
        className="bg-violet-600 active:opacity-80"
      >
        <Text className="px-4 pb-2 pt-1 text-center text-[13px] font-semibold text-white">
          {t.uploadBanner.privacyBlurring(preparing.length)} · {progress}%
        </Text>
      </Pressable>
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
      <Pressable
        onPress={() => openRecordings(uploading)}
        accessibilityRole="button"
        style={{ paddingTop: topInset }}
        className={`${stateColor} active:opacity-80`}
      >
        <Text className="px-4 pb-2 pt-1 text-center text-[13px] font-semibold text-white">
          {retrying ? t.uploadBanner.retrying : t.uploadBanner.keepOpen(n)}
          {attempt > 1 ? ` · ${t.uploadBanner.attempt(attempt)}` : ''}
          {progress != null ? ` · ${progress}%` : ''}
        </Text>
      </Pressable>
    );
  }

  // Failed but not permanent → let the user retry them all at once.
  const failed = recordings.filter(
    (recording) => recording.status === 'failed' && recording.resumable && !recording.permanent,
  );
  if (failed.length > 0) {
    return (
      <Pressable
        onPress={() => openRecordings(failed)}
        accessibilityRole="button"
        style={{ paddingTop: topInset }}
        className="flex-row items-center justify-between bg-red-600 px-4 pb-2 pt-1 active:opacity-80"
      >
        <Text className="flex-1 text-[13px] font-semibold text-white">
          {t.uploadBanner.failed(failed.length)}
        </Text>
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            failed.forEach((r) => retry(r.id));
          }}
          accessibilityRole="button"
          accessibilityLabel={t.uploadBanner.retryAll}
          className="ml-3 rounded-full bg-white/25 px-3 py-1 active:opacity-70"
        >
          <Text className="text-[13px] font-bold text-white">{t.uploadBanner.retryAll}</Text>
        </Pressable>
      </Pressable>
    );
  }

  const blurFailed = recordings.filter((recording) => recording.status === 'blur_failed');
  if (blurFailed.length > 0) {
    return (
      <Pressable
        onPress={() => openRecordings(blurFailed)}
        accessibilityRole="button"
        style={{ paddingTop: topInset }}
        className="bg-red-600 active:opacity-80"
      >
        <Text className="px-4 pb-2 pt-1 text-center text-[13px] font-semibold text-white">
          {t.uploadBanner.privacyBlurFailed(blurFailed.length)}
        </Text>
      </Pressable>
    );
  }

  return null;
}
