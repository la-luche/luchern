import { useNetworkState } from 'expo-network';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../lib/i18n';
import { UploadBanner } from './UploadBanner';

/**
 * Thin top banner shown only when the device is offline, so recordings that
 * queue for upload read as expected ("will upload later") instead of looking
 * broken. Participates in the root layout above the stack.
 */
function OfflineBanner({
  visible,
  includeTopInset,
}: {
  visible: boolean;
  includeTopInset: boolean;
}) {
  const insets = useSafeAreaInsets();
  const t = useT();

  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      style={{ paddingTop: includeTopInset ? insets.top : 0 }}
      className="bg-ink"
    >
      <Text className="px-4 pb-2 pt-1 text-center text-[13px] font-semibold text-white">
        {t.offline.message}
      </Text>
    </View>
  );
}

/**
 * Owns the complete top-banner stack so the device safe area is consumed once
 * even when offline and upload/privacy banners are visible together.
 */
export function TopBanners() {
  const net = useNetworkState();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  return (
    <>
      <OfflineBanner visible={offline} includeTopInset />
      <UploadBanner includeTopInset={!offline} />
    </>
  );
}
