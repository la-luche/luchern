import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { RecordingCard } from '../../components/RecordingCard';
import { Screen } from '../../components/Screen';
import { fetchGuest, type Guest, updateGuest } from '../../lib/guests';
import { useT } from '../../lib/i18n';
import { useRecordings } from '../../lib/storage';
import { COLORS } from '../../lib/theme';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'invalid';

export default function GuestProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const [guest, setGuest] = useState<Guest | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [loadingGuest, setLoadingGuest] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const lastSaved = useRef('');
  const latestQueued = useRef('');
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  const { recordings, loading: recordingsLoading, refresh } = useRecordings({ guestId: id });

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const loaded = await fetchGuest(id);
      setGuest(loaded);
      const serverKey = JSON.stringify([loaded.name, loaded.notes]);
      if (latestQueued.current === lastSaved.current) {
        setName(loaded.name);
        setNotes(loaded.notes);
        latestQueued.current = serverKey;
      }
      lastSaved.current = serverKey;
      setLoadFailed(false);
      void refresh().catch(() => {});
    } catch {
      setLoadFailed(true);
    } finally {
      setLoadingGuest(false);
    }
  }, [id, refresh]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!id) return <Redirect href="/guests" />;

  const queueSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveState('invalid');
      return;
    }
    const fields = { name: trimmedName, notes };
    const key = JSON.stringify([fields.name, fields.notes]);
    if (key === lastSaved.current || key === latestQueued.current) return;
    latestQueued.current = key;
    setSaveState('saving');
    saveTail.current = saveTail.current
      .catch(() => undefined)
      .then(async () => {
        const updated = await updateGuest(id, fields);
        lastSaved.current = key;
        setGuest(updated);
        if (latestQueued.current === key) {
          setName(updated.name);
          setNotes(updated.notes);
          setSaveState('saved');
        }
      })
      .catch(() => {
        if (latestQueued.current === key) {
          latestQueued.current = lastSaved.current;
          setSaveState('failed');
        }
      });
  };

  if (loadingGuest) {
    return (
      <Screen>
        <Header title={t.guests.profileTitle} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={COLORS.ink} />
        </View>
      </Screen>
    );
  }

  if (loadFailed || !guest) {
    return (
      <Screen>
        <Header title={t.guests.profileTitle} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-[17px] font-semibold text-ink">
            {t.guests.loadFailed}
          </Text>
          <Text className="mt-2 text-center text-[14px] leading-5 text-ink-muted">
            {t.guests.loadFailedBody}
          </Text>
          <View className="mt-6 w-full">
            <Button title={t.guests.tryAgain} onPress={() => void load()} />
          </View>
        </View>
      </Screen>
    );
  }

  const testCount = Math.max(guest.testCount, recordings.length);

  return (
    <Screen>
      <Header
        title={t.guests.profileTitle}
        onBack={() => {
          queueSave();
          router.back();
        }}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="px-6 pb-10 pt-3"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-[14px] font-semibold text-ink-muted">{t.guests.name}</Text>
          <TextInput
            value={name}
            onChangeText={(value) => {
              setName(value);
              setSaveState(value.trim() ? 'idle' : 'invalid');
            }}
            onBlur={queueSave}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={120}
            className={`mt-2 min-h-14 rounded-2xl border bg-white px-4 text-[20px] font-semibold text-ink ${
              saveState === 'invalid' ? 'border-red-500' : 'border-ink-faint'
            }`}
          />

          <View className="mt-5 flex-row items-center justify-between">
            <Text className="text-[14px] font-semibold text-ink-muted">{t.guests.notes}</Text>
            <Text
              accessibilityLiveRegion="polite"
              className={`text-[13px] ${saveState === 'failed' ? 'text-red-700' : 'text-ink-muted'}`}
            >
              {saveState === 'saving'
                ? t.guests.saving
                : saveState === 'saved'
                  ? t.guests.saved
                  : saveState === 'failed'
                    ? t.guests.saveFailed
                    : saveState === 'invalid'
                      ? t.guests.nameRequired
                      : ''}
            </Text>
          </View>
          <TextInput
            value={notes}
            onChangeText={(value) => {
              setNotes(value);
              setSaveState('idle');
            }}
            onBlur={queueSave}
            placeholder={t.guests.notesPlaceholder}
            placeholderTextColor={COLORS.inkMuted}
            multiline
            textAlignVertical="top"
            maxLength={2000}
            className="mt-2 min-h-28 rounded-2xl border border-ink-faint bg-white px-4 py-4 text-[16px] leading-6 text-ink"
          />

          <View className="mt-7">
            <Button
              title={t.guests.startNewTest}
              onPress={() => {
                queueSave();
                router.push({ pathname: '/tests', params: { guestId: id } });
              }}
            />
          </View>

          <View className="mb-3 mt-8 flex-row items-end justify-between">
            <Text className="text-[20px] font-bold text-ink">{t.guests.previousTests}</Text>
            <Text className="text-[14px] text-ink-muted">{t.guests.testCount(testCount)}</Text>
          </View>

          {recordingsLoading ? (
            <View className="items-center py-10">
              <ActivityIndicator color={COLORS.ink} />
            </View>
          ) : recordings.length === 0 ? (
            <View className="rounded-2xl bg-ink-faint px-5 py-7">
              <Text className="text-center text-[16px] font-semibold text-ink">
                {t.guests.noTestsTitle}
              </Text>
              <Text className="mt-2 text-center text-[14px] leading-5 text-ink-muted">
                {t.guests.noTestsBody}
              </Text>
            </View>
          ) : (
            <View className="gap-3">
              {recordings.map((recording) => (
                <RecordingCard
                  key={recording.id}
                  recording={recording}
                  onPress={() => {
                    queueSave();
                    router.push({
                      pathname: '/results/[id]',
                      params: { id: recording.id, guestId: id },
                    });
                  }}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
