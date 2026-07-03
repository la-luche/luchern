import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * White safe-area page wrapper used by every screen. Matches the Luche app's
 * flat white background. (The camera screen hand-rolls its own layout so the
 * preview can run under the insets — it does not use Screen.)
 */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 bg-white">
      <SafeAreaView edges={['top', 'bottom', 'left', 'right']} className="flex-1">
        {children}
      </SafeAreaView>
    </View>
  );
}
