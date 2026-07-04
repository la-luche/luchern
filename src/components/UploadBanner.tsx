import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../lib/i18n';
import { useRecordings } from '../lib/storage';
import { uploadingCount } from '../lib/uploadRetry';

/**
 * Thin top overlay shown ONLY while ≥1 recording is in the byte-upload phase.
 * Uploads are JS-driven (expo-file-system) and pause if the app is backgrounded,
 * so we tell the user to keep it open. pointerEvents="none" keeps it non-blocking.
 */
export function UploadBanner() {
  const { recordings } = useRecordings();
  const insets = useSafeAreaInsets();
  const t = useT();
  const n = uploadingCount(recordings);
  if (n === 0) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top, zIndex: 50 }}
      className="bg-blue-600"
    >
      <Text className="px-4 pb-2 pt-1 text-center text-[13px] font-semibold text-white">
        {t.uploadBanner.keepOpen(n)}
      </Text>
    </View>
  );
}
