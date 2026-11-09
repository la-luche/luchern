import { useUser } from '@clerk/clerk-expo';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Linking, RefreshControl, Text, View } from 'react-native';
import { Button } from '../../../components/Button';
import { Header } from '../../../components/Header';
import { RecordingCard } from '../../../components/RecordingCard';
import { TestHistoryChart } from '../../../components/ResultsTrends';
import { Screen } from '../../../components/Screen';
import { SharedRecordingCard } from '../../../components/SharedRecordingCard';
import { useGuests } from '../../../lib/guestStorage';
import { rememberHistorySelection } from '../../../lib/historySelection';
import { useT } from '../../../lib/i18n';
import { METHODOLOGY_URL } from '../../../lib/links';
import { historyPerson, historyRecordingHref, personHistoryHref, type HistoryPerson } from '../../../lib/personFlow';
import { groupTestHistory, type TestHistoryGroup, type TestHistoryRecording } from '../../../lib/testHistory';
import { COLORS } from '../../../lib/theme';
import { useOwnedHistory } from '../../../lib/useOwnedHistory';
import { useSharedHistory } from '../../../lib/useSharedHistory';
import { useSelfProfile } from '../../../lib/selfProfile';

/** One test type across all of one person's recordings, including checkups. */
export default function TestHistoryScreen() {
  const { testId, guestId, patientId } = useLocalSearchParams<{ testId: string; guestId?: string; patientId?: string }>();
  const { user } = useUser();
  const person = historyPerson(guestId, patientId === user?.id ? undefined : patientId);
  useFocusEffect(useCallback(() => {
    void rememberHistorySelection(user?.id, { person: historyPerson(guestId, patientId === user?.id ? undefined : patientId), section: 'tests' });
  }, [user?.id, guestId, patientId]));
  if (!testId) return <Redirect href={personHistoryHref(person)} />;
  const key = `${user?.id}:${person.kind}:${person.kind === 'me' ? '' : person.id}:${testId}`;
  return person.kind === 'shared'
    ? <SharedTestHistory key={key} testId={testId} accountId={user?.id} patientId={person.id} />
    : <OwnedTestHistory key={key} testId={testId} guestId={person.kind === 'guest' ? person.id : undefined} />;
}

function OwnedTestHistory({ testId, guestId }: { testId: string; guestId?: string }) {
  const t = useT();
  const { recordings, loading, refreshing, failed, refresh } = useOwnedHistory(guestId);
  const { guests } = useGuests();
  const { profile } = useSelfProfile(!guestId);
  const name = guestId ? guests.find((guest) => guest.id === guestId)?.name || t.resultsList.unnamedPerson : profile?.name || t.resultsList.me;
  return <TestHistoryContents testId={testId} person={historyPerson(guestId)} ownerName={name}
    group={groupTestHistory(recordings).find((group) => group.testId === testId)}
    loading={loading} refreshing={refreshing} failed={failed} refresh={() => void refresh()} />;
}

function SharedTestHistory({ testId, accountId, patientId }: { testId: string; accountId?: string; patientId: string }) {
  const t = useT();
  const { ownerName, recordings, loading, failed, refresh } = useSharedHistory(accountId, patientId);
  return <TestHistoryContents testId={testId} person={{ kind: 'shared', id: patientId }} ownerName={ownerName || t.resultsList.unnamedPerson}
    group={groupTestHistory(recordings).find((group) => group.testId === testId)}
    loading={loading} refreshing={loading} failed={failed} refresh={() => void refresh()} />;
}

function recordingKey(recording: TestHistoryRecording) {
  return 'trialId' in recording ? String(recording.trialId) : recording.id;
}

function TestHistoryContents({ testId, person, ownerName, group, loading, refreshing, failed, refresh }: {
  testId: string; person: HistoryPerson; ownerName: string; group?: TestHistoryGroup;
  loading: boolean; refreshing: boolean; failed: boolean; refresh: () => void;
}) {
  const router = useRouter();
  const t = useT();
  const recordings = group?.recordings ?? [];
  const first = recordings[0];
  const open = (recording: TestHistoryRecording) => {
    if ('trialId' in recording) {
      router.push({ pathname: '/shared/[id]', params: { id: String(recording.trialId), ownerName } });
    } else {
      const href = historyRecordingHref(recording);
      router.push({ ...href, params: { ...href.params, fromTestType: testId } });
    }
  };
  return (
    <Screen>
      <Header title={ownerName} onBack={() => router.dismissTo(personHistoryHref(person, 'tests'))} />
      <FlatList
        data={recordings}
        keyExtractor={recordingKey}
        contentContainerClassName="flex-grow px-6 pb-8"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={<>
          <TestHistoryChart testId={testId} fallbackName={first && 'trialId' in first ? first.testName : undefined} points={group?.points ?? []}
            onPointPress={(id) => { const recording = recordings.find((item) => recordingKey(item) === id); if (recording) open(recording); }} />
          <View className="mb-4 gap-3">
            <Text className="text-[14px] leading-5 text-ink-muted">{t.resultsList.trendsDisclaimer}</Text>
            <Button title={t.profile.scienceMethodology} variant="secondary" onPress={() => void Linking.openURL(METHODOLOGY_URL)} />
          </View>
          {failed && <View className="mb-4 gap-3">
            <Text className="text-[16px] leading-6 text-ink-muted">{t.resultsList.sharedLoadError}</Text>
            <Button title={t.resultsList.tryAgain} variant="secondary" onPress={refresh} />
          </View>}
        </>}
        renderItem={({ item }) => 'trialId' in item
          ? <SharedRecordingCard recording={item} onPress={() => open(item)} />
          : <View className="mb-3"><RecordingCard recording={item} onPress={() => open(item)} /></View>}
        ListEmptyComponent={loading ? <ActivityIndicator className="my-12" color={COLORS.ink} />
          : !failed ? <Text className="my-6 text-center text-[17px] text-ink-muted">{t.resultsList.emptyTitle}</Text> : null}
      />
    </Screen>
  );
}
