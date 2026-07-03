import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text } from 'react-native';

import { COLORS } from '../lib/theme';

type Provider = 'apple' | 'google';

const LABEL: Record<Provider, string> = {
  apple: 'Continue with Apple',
  google: 'Continue with Google',
};

const ICON: Record<Provider, keyof typeof Ionicons.glyphMap> = {
  apple: 'logo-apple',
  google: 'logo-google',
};

/**
 * Social sign-in pill. Apple = filled black (Apple HIG); Google = white with a
 * hairline border. Same 52px height / full radius as the primary Button so the
 * three sign-in options line up.
 */
export function SocialButton({
  provider,
  onPress,
  disabled = false,
}: {
  provider: Provider;
  onPress: () => void;
  disabled?: boolean;
}) {
  const isApple = provider === 'apple';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={LABEL[provider]}
      className={`h-[52px] flex-row items-center justify-center rounded-full px-6 active:opacity-80 ${
        isApple ? 'bg-black' : 'border border-ink-faint bg-white'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <Ionicons
        name={ICON[provider]}
        size={19}
        color={isApple ? COLORS.white : COLORS.ink}
        style={{ marginRight: 8 }}
      />
      <Text className={`text-[17px] font-semibold ${isApple ? 'text-white' : 'text-ink'}`}>
        {LABEL[provider]}
      </Text>
    </Pressable>
  );
}
