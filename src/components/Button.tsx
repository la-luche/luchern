import { Pressable, Text } from 'react-native';

type Variant = 'primary' | 'secondary' | 'destructive';
type Size = 'default' | 'large';

/**
 * The Luche pill button. `primary` = filled ink, `secondary` = faint ink fill
 * with ink text (the "Previous recordings" / "Data sharing" style).
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'default',
  disabled = false,
  className = '',
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  className?: string;
}) {
  const isPrimary = variant === 'primary';
  const isDestructive = variant === 'destructive';
  const isLarge = size === 'large';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      className={`items-center justify-center rounded-full px-6 active:opacity-80 ${
        isLarge ? 'min-h-[104px] py-5' : 'min-h-[52px] py-3'
      } ${
        isPrimary ? 'bg-ink' : isDestructive ? 'bg-red-600' : 'bg-ink-faint'
      } ${disabled ? 'opacity-40' : ''} ${className}`}
    >
      <Text
        numberOfLines={isLarge ? undefined : 2}
        style={{ width: '100%', textAlign: 'center' }}
        className={`font-semibold ${
          isLarge ? 'text-[32px] leading-[40px]' : 'text-[17px] leading-[22px]'
        } ${isPrimary || isDestructive ? 'text-white' : 'text-ink'}`}
      >
        {title}
      </Text>
    </Pressable>
  );
}
