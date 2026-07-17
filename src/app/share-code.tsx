import { useState } from 'react';
import { ActivityIndicator, Share, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { apiFetch } from '../lib/api';
import { useT } from '../lib/i18n';
import { COLORS } from '../lib/theme';

/**
 * Generate a code to share with another person. Whoever enters it links to you,
 * and their recordings become visible to you. Frontend only — the backend must
 * mint a short (4-digit) code and grant the generator viewing access (the
 * existing invite endpoints use long tokens + an observer role, so this needs
 * backend work before it functions end-to-end).
 */
type Phase = 'idle' | 'loading' | 'ready' | 'error';

export default function ShareCodeScreen() {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const [code, setCode] = useState('');

  const generate = async () => {
    setPhase('loading');
    try {
      const res = await apiFetch<{ code?: string; url?: string }>('/invites', { method: 'POST' });
      setCode(res.code ?? (res.url ? (res.url.split('/').pop() ?? '') : ''));
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  };

  const shareCode = () => {
    Share.share({ message: t.generate.shareMessage(code) }).catch(() => {});
  };

  return (
    <Screen>
      <Header title={t.generate.title} />
      <View className="flex-1 px-6 pt-4">
        {phase === 'idle' && (
          <>
            <Text className="text-[17px] leading-6 text-ink">{t.generate.prompt}</Text>
            <View className="mt-8">
              <Button title={t.generate.generate} onPress={() => void generate()} />
            </View>
          </>
        )}

        {phase === 'loading' && (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={COLORS.ink} />
          </View>
        )}

        {phase === 'ready' && (
          <View className="flex-1 items-center">
            <Text className="mt-6 text-[15px] font-semibold uppercase tracking-wide text-ink-muted">
              {t.generate.yourCode}
            </Text>
            <Text className="mt-3 text-[56px] font-bold tracking-[10px] text-ink">{code}</Text>
            <Text className="mt-5 px-2 text-center text-[15px] leading-6 text-ink-muted">
              {t.generate.instructions}
            </Text>
            <View className="mt-8 w-full">
              <Button title={t.generate.shareCode} onPress={shareCode} />
            </View>
          </View>
        )}

        {phase === 'error' && (
          <View className="flex-1 items-center justify-center px-2">
            <Text className="text-center text-[16px] leading-6 text-ink">{t.generate.error}</Text>
            <View className="mt-8 w-full">
              <Button title={t.invite.tryAgain} variant="secondary" onPress={() => setPhase('idle')} />
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}
