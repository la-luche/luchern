import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { RecordingCard } from '../../components/RecordingCard';
import { Screen } from '../../components/Screen';
import { useGuests } from '../../lib/guestStorage';
import { useT } from '../../lib/i18n';
import { startSession } from '../../lib/session';
import { useRecordings } from '../../lib/storage';
import { FULL_TEST_FLOW } from '../../lib/tests';
import { COLORS } from '../../lib/theme';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'invalid';

export default function GuestProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const { guests, loading: loadingGuest, refresh: refreshGuests, update } = useGuests();
  const guest = guests.find((item) => item.id === id) ?? null;
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const lastSaved = useRef('');
  const latestQueued = useRef('');
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  const initializedGuestId = useRef<string | null>(null);
  const {
    recordings,
    loading: recordingsLoading,
    refresh: refreshRecordings,
  } = useRecordings({ guestId: id });

  useEffect(() => {
    if (!guest) return;
    const storedKey = JSON.stringify([guest.name, guest.notes]);
    const canApplyStoredValue =
      initializedGuestId.current !== guest.id || latestQueued.current === lastSaved.current;
    if (canApplyStoredValue) {
      setName(guest.name);
      setNotes(guest.notes);
      latestQueued.current = storedKey;
      lastSaved.current = storedKey;
      initializedGuestId.current = guest.id;
    }
  }, [guest]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      await refreshGuests();
      void refreshRecordings().catch(() => {});
    } catch {}
  }, [id, refreshGuests, refreshRecordings]);

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
        const updated = await update(id, fields);
        lastSaved.current = key;
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

  if (!guest) {
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
        <FlatList
          data={recordingsLoading ? [] : recordings}
          keyExtractor={(recording) => recording.id}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          contentContainerClassName="px-6 pb-10 pt-3"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={<>
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
              title={t.guests.startFullCheck}
              onPress={() => {
                queueSave();
                startSession(FULL_TEST_FLOW);
                router.push({ pathname: '/prepare', params: { mode: 'full', guestId: id } });
              }}
            />
          </View>

          <View className="mb-3 mt-8 flex-row items-end justify-between">
            <Text className="text-[20px] font-bold text-ink">{t.guests.previousTests}</Text>
            <Text className="text-[14px] text-ink-muted">{t.guests.testCount(testCount)}</Text>
          </View>
          </>}
          ListEmptyComponent={recordingsLoading ? (
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
          ) : null}
          renderItem={({ item: recording }) => (
            <View className="mb-3">
              <RecordingCard
                recording={recording}
                onPress={() => {
                  queueSave();
                  router.push({
                    pathname: '/results/[id]',
                    params: { id: recording.id, guestId: id },
                  });
                }}
              />
            </View>
          )}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
