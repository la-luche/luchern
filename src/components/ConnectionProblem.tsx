import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { COLORS } from '../lib/theme';
import { Button } from './Button';

/** Full-screen recovery state for startup/auth connectivity failures. */
export function ConnectionProblem({
  title,
  body,
  retryLabel,
  onRetry,
}: {
  title: string;
  body: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center bg-white px-8">
      <MaterialCommunityIcons name="wifi-alert" size={52} color={COLORS.ink} />
      <Text className="mt-5 text-center text-[24px] font-bold text-ink">{title}</Text>
      <Text className="mt-2 text-center text-[16px] leading-6 text-ink-muted">{body}</Text>
      <View className="mt-7 w-full">
        <Button title={retryLabel} onPress={onRetry} />
      </View>
    </View>
  );
}
