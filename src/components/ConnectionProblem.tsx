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
  secondaryLabel,
  onSecondary,
  disabled = false,
}: {
  title: string;
  body: string;
  retryLabel: string;
  onRetry: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-1 items-center justify-center bg-white px-8">
      <MaterialCommunityIcons name="wifi-alert" size={52} color={COLORS.ink} />
      <Text className="mt-5 text-center text-[24px] font-bold text-ink">{title}</Text>
      <Text className="mt-2 text-center text-[16px] leading-6 text-ink-muted">{body}</Text>
      <View className="mt-7 w-full">
        <Button title={retryLabel} onPress={onRetry} disabled={disabled} />
        {!!secondaryLabel && onSecondary && <View className="mt-3">
          <Button title={secondaryLabel} variant="secondary" onPress={onSecondary} disabled={disabled} />
        </View>}
      </View>
    </View>
  );
}
