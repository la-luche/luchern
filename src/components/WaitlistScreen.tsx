import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../lib/i18n';
import { Button } from './Button';

export function WaitlistScreen({ email, busy = false, error, onCheck, onChangeEmail }: {
  email?: string | null; busy?: boolean; error?: string | null;
  onCheck: () => void; onChangeEmail: () => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  return <ScrollView className="flex-1 bg-white" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28,
    paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
    <Text accessibilityRole="header" className="text-[28px] font-bold text-ink">{t.auth.waitlistTitle}</Text>
    {!!email && <Text className="mt-3 text-[17px] text-ink">{email}</Text>}
    <Text className="mt-3 text-[17px] leading-6 text-ink-muted">{t.auth.waitlistBody}</Text>
    {!!error && <Text accessibilityRole="alert" className="mt-3 text-[15px] text-red-600">{error}</Text>}
    <View className="mt-8 gap-3">
      <Button title={busy ? t.auth.checkingAccess : t.auth.checkAccess} disabled={busy} onPress={onCheck} />
      <Button title={t.auth.useDifferentEmail} variant="secondary" disabled={busy} onPress={onChangeEmail} />
    </View>
  </ScrollView>;
}
