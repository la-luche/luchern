import { Pressable, Text } from 'react-native';

type Variant = 'primary' | 'secondary' | 'destructive';

/**
 * The Luche pill button. `primary` = filled ink, `secondary` = faint ink fill
 * with ink text (the "Previous recordings" / "Data sharing" style).
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  className = '',
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  className?: string;
}) {
  const isPrimary = variant === 'primary';
  const isDestructive = variant === 'destructive';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      className={`h-[52px] items-center justify-center rounded-full px-6 active:opacity-80 ${
        isPrimary ? 'bg-ink' : isDestructive ? 'bg-red-600' : 'bg-ink-faint'
      } ${disabled ? 'opacity-40' : ''} ${className}`}
    >
      <Text
        className={`text-[17px] font-semibold ${isPrimary || isDestructive ? 'text-white' : 'text-ink'}`}
      >
        {title}
      </Text>
    </Pressable>
  );
}
