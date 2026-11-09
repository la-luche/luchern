import { useUser } from '@clerk/clerk-expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { ApiError } from '../lib/api';
import { prepareGuestDeletion, deleteGuestWithRecordings, GuestHistoryChangedError, type GuestDeletionPreview } from '../lib/guestDeletion';
import { ensureGuestSyncedForAccount, useGuests } from '../lib/guestStorage';
import { rememberHistorySelection } from '../lib/historySelection';
import { useT } from '../lib/i18n';
import { historyPerson, personHistoryHref, type HistorySection } from '../lib/personFlow';
import { updateSelfProfile, useSelfProfile } from '../lib/selfProfile';
import { useRecordings } from '../lib/storage';
import { COLORS } from '../lib/theme';

export default function EditUserScreen() {
  const { user } = useUser();
  const { guestId, section } = useLocalSearchParams<{ guestId?: string; section?: string }>();
  if (!user) return null;
  return <Editor key={`${user.id}:${guestId ?? ''}`} accountId={user.id} guestId={guestId || undefined}
    section={section === 'checkups' ? 'checkups' : 'tests'} />;
}

function Editor({ accountId, guestId, section }: {
  accountId: string; guestId?: string; section: HistorySection;
}) {
  const router = useRouter();
  const t = useT();
  const { guests, loading: guestsLoading, update, refresh } = useGuests();
  const self = useSelfProfile(!guestId);
  const { loading: recordingsLoading } = useRecordings({ guestId });
  const profile = guestId ? guests.find(guest => guest.id === guestId) : self.profile;
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<'saving' | 'preparing' | 'deleting' | null>(null);
  const [preview, setPreview] = useState<GuestDeletionPreview | null>(null);
  const [countdown, setCountdown] = useState(5);
  const initialized = useRef(false);
  const dirty = useRef({ name: false, notes: false });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!profile) return;
    initialized.current = true;
    // Refresh cached values without replacing fields the person is editing.
    if (!dirty.current.name) setName(profile.name || t.resultsList.me);
    if (!dirty.current.notes) setNotes(profile.notes);
  }, [profile, t.resultsList.me]);
  useEffect(() => {
    if (!preview || countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(n => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [preview, countdown]);
  const back = () => router.dismissTo(personHistoryHref(historyPerson(guestId), section));
  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy('saving');
    try {
      const fields = { name: name.trim(), notes: notes.trim() };
      if (guestId) {
        await update(guestId, fields);
        void ensureGuestSyncedForAccount(accountId, guestId).catch(() => {});
      } else await updateSelfProfile(accountId, fields);
      if (mounted.current) back();
    } catch {
      if (mounted.current) Alert.alert(t.people.saveFailedTitle, t.guests.createFailedBody);
    } finally { if (mounted.current) setBusy(null); }
  };
  const confirmDelete = async () => {
    if (busy || !guestId) return;
    setBusy('preparing');
    try {
      const next = await prepareGuestDeletion(accountId, guestId);
      if (!mounted.current) return;
      Alert.alert(t.people.deleteWarningTitle(name), t.people.deleteWarningBody(next.testCount), [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.common.continue, style: 'destructive', onPress: () => {
          if (!mounted.current) return;
          setCountdown(5); setPreview(next);
        } },
      ]);
    } catch {
      if (mounted.current) Alert.alert(t.people.deleteFailedTitle, t.people.deleteFailedBody);
    } finally { if (mounted.current) setBusy(null); }
  };
  const finishDelete = async () => {
    if (!preview || busy || countdown > 0) return;
    setBusy('deleting');
    try {
      await deleteGuestWithRecordings(preview);
      await rememberHistorySelection(accountId, { person: { kind: 'me' }, section });
      if (mounted.current) router.dismissTo(personHistoryHref({ kind: 'me' }, section));
    } catch (error) {
      if (!mounted.current) return;
      setPreview(null);
      const changed = error instanceof GuestHistoryChangedError ||
        (error instanceof ApiError && error.status === 409 && error.responseBody.includes('history_changed'));
      Alert.alert(t.people.deleteFailedTitle, changed ? t.people.historyChanged : t.people.deleteFailedBody);
    } finally { if (mounted.current) setBusy(null); }
  };

  const loading = guestId ? guestsLoading : self.loading;
  return <Screen>
    <Header title={t.people.editUser} onBack={() => { if (!busy) back(); }} />
    {!initialized.current && (loading || !!profile) ? <View className="flex-1 items-center justify-center"><ActivityIndicator color={COLORS.ink} /></View>
      : !initialized.current ? <View className="gap-5 px-6 pt-6">
        <Text className="text-[17px] text-ink">{t.people.profileUnavailable}</Text>
        <Button title={t.guests.tryAgain} onPress={() => { void (guestId ? refresh() : self.refresh()).catch(() => {}); }} />
      </View> : <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="px-6 pb-10 pt-4" keyboardShouldPersistTaps="handled">
          <Text className="text-[15px] font-semibold text-ink">{t.guests.name}</Text>
          <TextInput accessibilityLabel={t.guests.name} value={name} onChangeText={value => { dirty.current.name = true; setName(value); }} editable={!busy}
            autoCapitalize="words" autoCorrect={false} maxLength={120}
            className="mt-2 min-h-14 rounded-2xl border border-ink-faint bg-white px-4 text-[20px] text-ink" />
          <Text className="mt-6 text-[15px] font-semibold text-ink">{t.guests.notes}</Text>
          <TextInput accessibilityLabel={t.guests.notes} value={notes} onChangeText={value => { dirty.current.notes = true; setNotes(value); }} editable={!busy}
            multiline textAlignVertical="top" maxLength={2000} placeholder={t.guests.notesPlaceholder} placeholderTextColor={COLORS.inkMuted}
            className="mt-2 min-h-32 rounded-2xl border border-ink-faint bg-white px-4 py-4 text-[17px] leading-6 text-ink" />
          <View className="mt-8"><Button title={busy === 'saving' ? t.guests.saving : t.people.saveUser}
            onPress={() => void save()} disabled={!!busy || !name.trim()} /></View>
          {guestId && <View className="mt-10"><Button variant="destructive"
            title={busy === 'preparing' ? t.people.countingTests : busy === 'deleting' ? t.profile.deletingAccount : t.people.deleteUser}
            onPress={() => void confirmDelete()} disabled={!!busy || recordingsLoading} /></View>}
        </ScrollView>
      </KeyboardAvoidingView>}
    <Modal visible={preview != null} transparent animationType="none" onRequestClose={() => { if (!busy) setPreview(null); }}>
      <SafeAreaView className="flex-1 items-center justify-center bg-black/50 px-7 py-6">
        <View className="w-full max-w-sm shrink rounded-3xl bg-white" accessibilityViewIsModal>
          <ScrollView bounces={false} contentContainerClassName="p-6">
          <Text className="text-center text-[22px] font-bold text-ink">{countdown ? t.profile.deleteCountdownTitle : t.profile.deleteFinalTitle}</Text>
          <Text className="mt-3 text-center text-[16px] leading-6 text-ink">{t.people.deleteWarningTitle(name)}</Text>
          <Text className="mt-3 text-center text-[16px] leading-6 text-ink-muted">{t.people.deleteWarningBody(preview?.testCount ?? 0)}</Text>
          {!!countdown && <Text className="mt-5 text-center text-[48px] font-bold text-red-600">{countdown}</Text>}
          <View className="mt-5 gap-3">
            {countdown === 0 && <Button title={busy === 'deleting' ? t.profile.deletingAccount : t.people.deleteUserAndTests(preview?.testCount ?? 0)}
              variant="destructive" disabled={!!busy} onPress={() => void finishDelete()} />}
            <Button title={t.people.keepUser} variant="secondary" disabled={!!busy} onPress={() => setPreview(null)} />
          </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </Screen>;
}
