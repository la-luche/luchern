import { useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { RecordingThumbnail } from '../../components/RecordingThumbnail';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { availableGrade, formatCheckupScore, groupCheckups, type CheckupRecording } from '../../lib/checkups';
import { useGuests } from '../../lib/guestStorage';
import { rememberHistorySelection } from '../../lib/historySelection';
import { formatEvaluatedSide, useT } from '../../lib/i18n';
import { METHODOLOGY_URL } from '../../lib/links';
import { historyPerson, historyRecordingHref, personHistoryHref, type HistoryPerson } from '../../lib/personFlow';
import { useRecordings } from '../../lib/storage';
import { getTest } from '../../lib/tests';
import { COLORS } from '../../lib/theme';
import { useSharedHistory } from '../../lib/useSharedHistory';
import { useSelfProfile } from '../../lib/selfProfile';

export default function CheckupResultScreen() {
  const { id, guestId, patientId } = useLocalSearchParams<{ id: string; guestId?: string; patientId?: string }>();
  const { user } = useUser();
  const person = historyPerson(guestId, patientId === user?.id ? undefined : patientId);
  useFocusEffect(useCallback(() => {
    void rememberHistorySelection(user?.id, { person: historyPerson(guestId, patientId === user?.id ? undefined : patientId), section: 'checkups' });
  }, [user?.id, guestId, patientId]));
  const key = `${user?.id}:${person.kind}:${person.kind === 'me' ? '' : person.id}:${id}`;
  return person.kind === 'shared'
    ? <SharedCheckup key={key} id={id} patientId={person.id} accountId={user?.id} />
    : <OwnedCheckup key={key} id={id} guestId={person.kind === 'guest' ? person.id : undefined} />;
}

function OwnedCheckup({ id, guestId }: { id: string; guestId?: string }) {
  const t = useT();
  const { recordings, loading, refresh } = useRecordings({ guestId });
  const { guests } = useGuests();
  const { profile } = useSelfProfile(!guestId);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setRefreshing(true);
    setFailed(false);
    try { await refresh(); }
    catch { if (current === request.current) setFailed(true); }
    finally { if (current === request.current) setRefreshing(false); }
  }, [refresh]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { ++request.current; };
  }, [load]));
  const name = guestId ? guests.find((guest) => guest.id === guestId)?.name || t.resultsList.unnamedPerson : profile?.name || t.resultsList.me;
  return <CheckupContents id={id} person={historyPerson(guestId)} ownerName={name} recordings={recordings}
    loading={loading} refreshing={refreshing} failed={failed} refresh={() => void load()} />;
}

function SharedCheckup({ id, patientId, accountId }: { id: string; patientId: string; accountId?: string }) {
  const t = useT();
  const { ownerName, recordings, loading, failed, refresh } = useSharedHistory(accountId, patientId);
  return <CheckupContents id={id} person={{ kind: 'shared', id: patientId }} ownerName={ownerName || t.resultsList.unnamedPerson}
    recordings={recordings} loading={loading} refreshing={loading} failed={failed} refresh={() => void refresh()} />;
}

function CheckupContents({ id, person, ownerName, recordings, loading, refreshing, failed, refresh }: {
  id: string; person: HistoryPerson; ownerName: string; recordings: CheckupRecording[];
  loading: boolean; refreshing: boolean; failed: boolean; refresh: () => void;
}) {
  const router = useRouter();
  const t = useT();
  const checkup = groupCheckups(recordings).find((run) => run.id === id);
  const back = () => router.dismissTo(personHistoryHref(person, 'checkups'));
  const openRecording = (recording: CheckupRecording) => {
    if ('trialId' in recording) {
      router.push({ pathname: '/shared/[id]', params: { id: String(recording.trialId), ownerName } });
    } else {
      const href = historyRecordingHref(recording);
      router.push({ ...href, params: { ...href.params, fromCheckup: id } });
    }
  };
  return (
    <Screen>
      <Header title={t.checkups.title} onBack={back} />
      <ScrollView contentContainerClassName="px-5 pb-10" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <Text className="text-[22px] font-semibold text-ink">{ownerName}</Text>
        {failed && <View className="my-4 gap-3"><Text className="text-[16px] text-ink-muted">{t.resultsList.sharedLoadError}</Text><Button title={t.resultsList.tryAgain} variant="secondary" onPress={refresh} /></View>}
        {checkup ? <>
          <Text className="mt-1 text-[15px] text-ink-muted">{new Date(checkup.startedAt).toLocaleString()}</Text>
          <View className="items-center py-8">
            <Text className="text-[21px] font-semibold text-ink">{t.checkups.overall}</Text>
            <Text accessibilityLabel={`${t.checkups.overall}: ${formatCheckupScore(checkup.overall.value)} ${t.checkups.outOfFour}`} className="mt-1 text-[72px] font-semibold leading-[86px] text-ink">{formatCheckupScore(checkup.overall.value)}</Text>
            <Text className="text-[17px] text-ink-muted">{t.checkups.outOfFour}</Text>
            <Text className="mt-3 text-center text-[16px] text-ink-muted">{t.checkups.available(checkup.overall.count, checkup.expectedSteps)}</Text>
          </View>
          <View className="flex-row flex-wrap border-t border-ink-faint">
            {(['left', 'right', 'walking', 'standing'] as const).map((category) => (
              <View key={category} className="w-1/2 gap-1 py-5 pr-4">
                <Text className="text-[17px] font-semibold text-ink">{t.checkups[category]}</Text>
                <Text className="text-[34px] font-semibold text-ink">{formatCheckupScore(checkup[category].value)}</Text>
                <Text className="text-[14px] text-ink-muted">{checkup[category].count ? t.checkups.scored(checkup[category].count) : t.checkups.noScore}</Text>
              </View>
            ))}
          </View>
          <Text className="mt-1 text-[15px] leading-6 text-ink-muted">{t.checkups.averageHint}</Text>
          <Text className="mt-2 text-[14px] leading-5 text-ink-muted">{t.resultsList.trendsDisclaimer}</Text>
          <View className="mt-4"><Button title={t.profile.scienceMethodology} variant="secondary" onPress={() => void Linking.openURL(METHODOLOGY_URL)} /></View>
          <Text accessibilityRole="header" className="mb-4 mt-8 text-[24px] font-semibold text-ink">{t.checkups.recordings}</Text>
          <View className="overflow-hidden rounded-2xl bg-ink-faint">
            {checkup.recordings.map((recording, index) => {
              const test = getTest(recording.testId);
              const side = test ? formatEvaluatedSide(t, test, recording.evaluatedSide) : undefined;
              const name = test ? t.tests[test.id].name : 'testName' in recording ? recording.testName : t.recordingCard.fallback;
              const uri = 'trialId' in recording ? undefined : recording.videoUri || recording.originalVideoUri;
              const score = availableGrade(recording);
              const open = () => openRecording(recording);
              return <Pressable key={'trialId' in recording ? recording.trialId : recording.id} accessibilityRole="button"
                accessibilityLabel={`${name}${side ? `, ${side}` : ''}`} onPress={open}
                className={`flex-row items-center gap-3 px-4 py-4 active:opacity-70 ${index > 0 ? 'border-t border-black/5' : ''}`}>
                {uri ? <RecordingThumbnail uri={uri} onPress={open} /> : <View className="h-24 w-28 items-center justify-center rounded-xl bg-ink"><Ionicons name="videocam-outline" size={28} color={COLORS.white} /></View>}
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="text-[16px] font-semibold text-ink">{name}</Text>
                  {side && <Text className="text-[14px] text-ink-muted">{side}</Text>}
                  {score !== null ? <Text className="text-[20px] font-semibold text-ink">{formatCheckupScore(score)} <Text className="text-[14px] font-normal">{t.checkups.outOfFour}</Text></Text>
                    : 'trialId' in recording ? <Text className="text-[14px] text-ink-muted">{t.checkups.noScore}</Text> : <StatusPill status={recording.status} />}
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.ink} />
              </Pressable>;
            })}
          </View>
        </> : loading ? <ActivityIndicator className="my-12" color={COLORS.ink} /> : !failed ? <Text className="my-10 text-[17px] text-ink-muted">{t.checkups.notFound}</Text> : null}
        <View className="mt-8"><Button title={t.people.backToHistory} variant="secondary" onPress={back} /></View>
      </ScrollView>
    </Screen>
  );
}
