import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../lib/i18n';
import { useRecordings } from '../lib/storage';
import { uploadingCount } from '../lib/uploadRetry';

/**
 * Thin top status shown ONLY while ≥1 recording is in the byte-upload phase.
 * It participates in root layout so it never covers navigation or screen UI.
 */
export function UploadBanner() {
  const { recordings } = useRecordings();
  const insets = useSafeAreaInsets();
  const t = useT();
  const n = uploadingCount(recordings);
  if (n === 0) return null;
  const uploading = recordings.filter((r) => r.status === 'uploading');
  const attempt = Math.max(...uploading.map((r) => r.uploadAttempt ?? 1));
  const retrying = uploading.some((r) => r.uploadRetrying);
  const progress = uploading.length
    ? Math.round(
        (uploading.reduce((sum, r) => sum + (r.uploadProgress ?? 0), 0) / uploading.length) * 100,
      )
    : null;
  const stateColor = retrying
    ? 'bg-red-600'
    : attempt > 1
      ? 'bg-amber-500'
      : 'bg-blue-600';
  return (
    <View
      pointerEvents="none"
      style={{ paddingTop: insets.top }}
      className={stateColor}
    >
      <Text className="px-4 pb-2 pt-1 text-center text-[13px] font-semibold text-white">
        {retrying ? t.uploadBanner.retrying : t.uploadBanner.keepOpen(n)}
        {attempt > 1 ? ` · ${t.uploadBanner.attempt(attempt)}` : ''}
        {progress != null ? ` · ${progress}%` : ''}
      </Text>
    </View>
  );
}
