import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { ApiError, apiFetch } from '../lib/api';
import { useT } from '../lib/i18n';
import { COLORS } from '../lib/theme';

/**
 * Accept another account's sharing code. The signed-in user enters the code,
 * confirms the viewer, and creates the relationship server-side.
 */
type InviteInfo = { observer_name?: string | null };
type Phase = 'enter' | 'loading' | 'confirm' | 'accepting' | 'done' | 'error';
type InviteErr = 'notFound' | 'selfInvite' | 'expired' | 'revoked' | 'capReached' | 'generic';

function inviteErrorKey(e: unknown): InviteErr {
  if (e instanceof ApiError) {
    try {
      const code = (JSON.parse(e.responseBody) as { error?: string }).error;
      if (e.status === 400 && code === 'self_invite') return 'selfInvite';
      if (e.status === 410 && code === 'expired') return 'expired';
      if (e.status === 410 && code === 'revoked') return 'revoked';
      if (e.status === 410 && code === 'cap_reached') return 'capReached';
    } catch {
      // fall through to status/generic handling
    }
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}

export default function InviteScreen() {
  const router = useRouter();
  const t = useT();

  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('enter');
  const [observer, setObserver] = useState('');
  const [errKey, setErrKey] = useState<InviteErr>('generic');

  const load = async (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    setPhase('loading');
    try {
      const info = await apiFetch<InviteInfo>(`/invites/${encodeURIComponent(clean)}`);
      setObserver(info.observer_name || t.invite.yourDoctor);
      setPhase('confirm');
    } catch (e) {
      setErrKey(inviteErrorKey(e));
      setPhase('error');
    }
  };

  const accept = async () => {
    setPhase('accepting');
    try {
      const res = await apiFetch<InviteInfo>(`/invites/${encodeURIComponent(code.trim())}/accept`, {
        method: 'POST',
      });
      setObserver(res.observer_name || observer || t.invite.yourDoctor);
      setPhase('done');
    } catch (e) {
      setErrKey(inviteErrorKey(e));
      setPhase('error');
    }
  };

  return (
    <Screen>
      <Header title={t.invite.title} />
      <View className="flex-1 px-6 pt-4">
        {phase === 'enter' && (
          <>
            <Text className="text-[17px] leading-6 text-ink">{t.invite.enterPrompt}</Text>
            <TextInput
              className="mt-6 h-[64px] rounded-2xl border border-ink-faint px-4 text-center text-[32px] font-semibold tracking-[16px] text-ink"
              placeholder={t.invite.codePlaceholder}
              placeholderTextColor="#9ca3af"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={4}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 4))}
              onSubmitEditing={() => void load(code)}
              returnKeyType="go"
            />
            <View className="mt-6">
              <Button
                title={t.common.continue}
                onPress={() => void load(code)}
                disabled={code.trim().length !== 4}
              />
            </View>
          </>
        )}

        {(phase === 'loading' || phase === 'accepting') && (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={COLORS.ink} />
          </View>
        )}

        {phase === 'confirm' && (
          <View className="flex-1">
            <Text className="text-[24px] font-bold text-ink">{t.invite.confirmTitle(observer)}</Text>
            <Text className="mt-3 text-[16px] leading-6 text-ink-muted">{t.invite.confirmBody}</Text>
            <View className="mt-8 gap-3">
              <Button title={t.invite.allow} onPress={() => void accept()} />
              <Button title={t.common.cancel} variant="secondary" onPress={() => router.back()} />
            </View>
          </View>
        )}

        {phase === 'done' && (
          <View className="flex-1 items-center justify-center px-2">
            <Text className="text-center text-[24px] font-bold text-ink">{t.invite.linkedTitle}</Text>
            <Text className="mt-3 text-center text-[16px] leading-6 text-ink-muted">
              {t.invite.linkedBody(observer)}
            </Text>
            <View className="mt-8 w-full">
              <Button title={t.invite.done} onPress={() => router.replace('/')} />
            </View>
          </View>
        )}

        {phase === 'error' && (
          <View className="flex-1 items-center justify-center px-2">
            <Text className="text-center text-[16px] leading-6 text-ink">{t.invite.errors[errKey]}</Text>
            <View className="mt-8 w-full gap-3">
              <Button title={t.invite.tryAgain} variant="secondary" onPress={() => setPhase('enter')} />
              <Button title={t.common.back} onPress={() => router.back()} />
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}
