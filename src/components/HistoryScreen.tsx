import { useUser } from '@clerk/clerk-expo';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, Text, View } from 'react-native';

import { Button } from './Button';
import { Header } from './Header';
import { RecordingCard } from './RecordingCard';
import { SharedRecordingCard } from './SharedRecordingCard';
import { TestHistoryChart } from './ResultsTrends';
import { Screen } from './Screen';
import { useGuests } from '../lib/guestStorage';
import { useT } from '../lib/i18n';
import { METHODOLOGY_URL } from '../lib/links';
import { checkupHref, historyPerson, historyRecordingHref, testHistoryHref, type HistoryPerson, type HistorySection } from '../lib/personFlow';
import { useSharedHistory } from '../lib/useSharedHistory';
import { groupCheckups } from '../lib/checkups';
import { rememberHistorySelection } from '../lib/historySelection';
import { CheckupCard } from './CheckupCard';
import { CheckupHistoryChart } from './CheckupHistoryChart';
import { useOwnedHistory } from '../lib/useOwnedHistory';
import { groupTestHistory, testsNewestFirst } from '../lib/testHistory';
import { COLORS } from '../lib/theme';
import { useSelfProfile } from '../lib/selfProfile';
import { deletedGuestIds } from '../lib/guestDeletionState';

/** Each route identifies one person's history; changing it resets all view state. */
export function HistoryScreen() {
  const { guestId, patientId, section: sectionParam } = useLocalSearchParams<{ guestId?: string; patientId?: string; section?: string }>();
  const section: HistorySection = sectionParam === 'checkups' ? 'checkups' : 'tests';
  const { user } = useUser();
  const person = historyPerson(guestId, patientId === user?.id ? undefined : patientId);
  useFocusEffect(useCallback(() => {
    void rememberHistorySelection(user?.id, { person: historyPerson(guestId, patientId === user?.id ? undefined : patientId), section });
  }, [user?.id, guestId, patientId, section]));
  const key = `${user?.id}:${person.kind}:${person.kind === 'me' ? '' : person.id}`;
  return person.kind === 'shared'
    ? <SharedHistory key={key} accountId={user?.id} patientId={person.id} section={section} />
    : <OwnedHistory key={key} guestId={person.kind === 'guest' ? person.id : undefined} section={section} />;
}

function OwnedHistory({ guestId, section }: { guestId?: string; section: HistorySection }) {
  const router = useRouter();
  const t = useT();
  const { recordings, loading, refreshing, failed, refresh } = useOwnedHistory(guestId);
  const { guests } = useGuests();
  const { user } = useUser();
  useFocusEffect(useCallback(() => {
    if (guestId && user?.id && deletedGuestIds(user.id).has(guestId)) router.setParams({ guestId: '', patientId: '' });
  }, [guestId, user?.id, guests]));
  const { profile } = useSelfProfile(!guestId);
  const guest = guests.find((guest) => guest.id === guestId);
  const notes = guestId ? guest?.notes : profile?.notes;
  const editUser = () => router.push({ pathname: '/edit-user', params: { guestId: guestId ?? '', section } });
  const ownerName = guestId
    ? guests.find((guest) => guest.id === guestId)?.name || t.resultsList.unnamedPerson
    : profile?.name || t.resultsList.me;

  const person = historyPerson(guestId);
  const checkups = groupCheckups(recordings);
  if (section === 'checkups') return (
    <HistoryList
      section={section} ownerName={ownerName}
      notes={notes} onEditUser={editUser}
      recordings={checkups} loading={loading} refreshing={refreshing}
      failed={failed} onRefresh={() => void refresh()} keyExtractor={(checkup) => checkup.id}
      renderRecording={(checkup) => <CheckupCard checkup={checkup} onPress={() => router.push(checkupHref(checkup.id, person))} />}
      chart={<CheckupHistoryChart checkups={checkups} onPointPress={(id) => router.push(checkupHref(id, person))} />}
    />
  );
  const tests = groupTestHistory(recordings);
  return (
    <HistoryList
      section={section}
      ownerName={ownerName}
      notes={notes} onEditUser={editUser}
      recordings={testsNewestFirst(recordings)}
      loading={loading}
      refreshing={refreshing}
      failed={failed}
      onRefresh={() => void refresh()}
      keyExtractor={(recording) => recording.id}
      renderRecording={(recording) => <View className="mb-3">
        <RecordingCard recording={recording} onPress={() => router.push(historyRecordingHref(recording))} />
      </View>}
      chart={<View>{tests.map((group) => <TestHistoryChart key={group.testId} testId={group.testId} points={group.points}
        onPress={() => router.push(testHistoryHref(group.testId, person))} />)}</View>}
    />
  );
}

function SharedHistory({ accountId, patientId, section }: { accountId?: string; patientId: string; section: HistorySection }) {
  const router = useRouter();
  const t = useT();
  const { ownerName, recordings, loading, failed, refresh } = useSharedHistory(accountId, patientId);
  const name = ownerName || t.resultsList.unnamedPerson;
  const person: HistoryPerson = { kind: 'shared', id: patientId };
  const checkups = groupCheckups(recordings);
  if (section === 'checkups') return (
    <HistoryList
      section={section} ownerName={name} shared
      recordings={checkups} loading={loading} refreshing={loading}
      failed={failed} onRefresh={() => void refresh()} keyExtractor={(checkup) => checkup.id}
      renderRecording={(checkup) => <CheckupCard checkup={checkup} onPress={() => router.push(checkupHref(checkup.id, person))} />}
      chart={<CheckupHistoryChart checkups={checkups} onPointPress={(id) => router.push(checkupHref(id, person))} />}
    />
  );
  const tests = groupTestHistory(recordings);
  return (
    <HistoryList
      section={section}
      ownerName={name}
      shared
      recordings={testsNewestFirst(recordings)}
      loading={loading}
      refreshing={loading}
      failed={failed}
      onRefresh={() => void refresh()}
      keyExtractor={(recording) => String(recording.trialId)}
      renderRecording={(recording) => <SharedRecordingCard recording={recording}
        onPress={() => router.push({ pathname: '/shared/[id]', params: { id: String(recording.trialId), ownerName: name } })} />}
      chart={<View>{tests.map((group) => <TestHistoryChart key={group.testId} testId={group.testId} fallbackName={group.recordings[0]?.testName} points={group.points}
        onPress={() => router.push(testHistoryHref(group.testId, person))} />)}</View>}
    />
  );
}

function HistoryList<T>({
  section, ownerName, shared = false, recordings, loading, refreshing, failed, onRefresh,
  keyExtractor, renderRecording, chart,
  notes, onEditUser,
}: {
  section: HistorySection;
  ownerName: string;
  shared?: boolean;
  recordings: T[];
  loading: boolean;
  refreshing: boolean;
  failed: boolean;
  onRefresh: () => void;
  keyExtractor: (recording: T) => string;
  renderRecording: (recording: T) => ReactNode;
  chart?: ReactNode;
  notes?: string;
  onEditUser?: () => void;
}) {
  const router = useRouter();
  const t = useT();
  return (
    <Screen>
      <Header title={t.resultsList.title} onBack={() => router.dismissTo('/')}
        rightWidth={onEditUser ? 132 : 48}
        right={onEditUser ? <Button title={t.people.editUser} variant="secondary" onPress={onEditUser} className="w-full px-3" /> : undefined} />
      <View className="shrink-0 px-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t.people.changeUser}: ${ownerName}${shared ? `. ${t.people.sharedWithMe}` : ''}`}
          onPress={() => router.push({ pathname: '/people', params: { mode: 'history', returnToHistory: '1', historySection: section } })}
          className="mb-5 min-h-[88px] flex-row items-center gap-4 rounded-3xl bg-ink-faint px-6 py-5 active:opacity-70"
        >
          <View className="flex-1 gap-1">
            <Text className="text-[28px] font-semibold leading-[36px] text-ink">{ownerName}</Text>
            <Text className="text-[15px] text-ink-muted">{shared ? t.people.sharedWithMe : t.people.changeUser}</Text>
          </View>
          <Ionicons name="chevron-down" size={24} color={COLORS.ink} />
        </Pressable>
        <View className="mb-6 flex-row gap-2 rounded-2xl bg-ink-faint p-1">
          {(['checkups', 'tests'] as const).map((tab) => (
            <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={t.checkups[tab]} accessibilityState={{ selected: section === tab }}
              onPress={() => { if (section !== tab) router.setParams({ section: tab }); }}
              className={`min-h-14 flex-1 items-center justify-center rounded-xl px-3 py-3 ${section === tab ? 'bg-ink' : ''}`}>
              <Text className={`text-[18px] font-semibold ${section === tab ? 'text-white' : 'text-ink'}`}>{t.checkups[tab]}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <FlatList
        key={section}
        className="flex-1"
        data={recordings}
        keyExtractor={keyExtractor}
        contentContainerClassName="flex-grow px-6 pb-8"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View className="pb-4">
            {!!notes?.trim() && <View className="mb-5">
              <Text className="mb-1 text-[15px] font-semibold text-ink">{t.guests.notes}</Text>
              <Text className="text-[16px] leading-6 text-ink-muted">{notes.trim()}</Text>
            </View>}
            {failed && (
              <View className="mb-4 gap-3">
                <Text className="text-[16px] leading-6 text-ink-muted">{t.resultsList.sharedLoadError}</Text>
                <Button title={t.resultsList.tryAgain} variant="secondary" onPress={onRefresh} />
              </View>
            )}
            {chart}
            <Text className="mb-3 text-[14px] leading-5 text-ink-muted">{t.resultsList.trendsDisclaimer}</Text>
            <Button title={t.profile.scienceMethodology} variant="secondary" onPress={() => void Linking.openURL(METHODOLOGY_URL)} />
          </View>
        }
        renderItem={({ item }) => <View>{renderRecording(item)}</View>}
        ListEmptyComponent={loading ? (
          <View className="items-center py-12"><ActivityIndicator color={COLORS.ink} /></View>
        ) : !failed ? (
          <View className="items-center px-4 py-12">
            <MaterialCommunityIcons name="video-off-outline" size={52} color={COLORS.inkFaint} />
            <Text className="mt-4 text-center text-[17px] font-semibold text-ink">
              {section === 'checkups' ? t.checkups.emptyTitle : shared ? t.resultsList.noSharedRecordings : t.resultsList.emptyTitle}
            </Text>
            {!shared && <Text className="mt-1 text-center text-[14px] text-ink-muted">{section === 'checkups' ? t.checkups.emptyBody : t.resultsList.emptyBody}</Text>}
          </View>
        ) : null}
      />
    </Screen>
  );
}
