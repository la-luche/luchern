import { useNetworkState } from 'expo-network';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../lib/i18n';

/**
 * Thin top banner shown only when the device is offline, so recordings that
 * queue for upload read as expected ("will upload later") instead of looking
 * broken. Participates in the root layout above the stack.
 */
export function OfflineBanner() {
  const net = useNetworkState();
  const insets = useSafeAreaInsets();
  const t = useT();

  // isConnected / isInternetReachable can be undefined before the first probe —
  // only show the banner once we know it's actually offline.
  const offline = net.isConnected === false || net.isInternetReachable === false;
  if (!offline) return null;

  return (
    <View pointerEvents="none" style={{ paddingTop: insets.top }} className="bg-ink">
      <Text className="px-4 pb-2 pt-1 text-center text-[13px] font-semibold text-white">
        {t.offline.message}
      </Text>
    </View>
  );
}
