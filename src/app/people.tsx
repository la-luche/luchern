import { useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { useGuests } from '../lib/guestStorage';
import { useT } from '../lib/i18n';
import { beginPersonTest, personHistoryHref, personPickerMode, type HistoryPerson } from '../lib/personFlow';
import { fetchSharedPatients, type SharedPatient } from '../lib/sharedRecordings';
import { COLORS } from '../lib/theme';
import { useSelfProfile } from '../lib/selfProfile';

type PersonRow = HistoryPerson & { key: string; name: string };

export default function PeopleScreen() {
  const { user } = useUser();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return <PeoplePicker key={`${user?.id}:${mode}`} accountId={user?.id} />;
}

function PeoplePicker({ accountId }: { accountId?: string }) {
  const { mode: modeParam, returnToHistory, historySection } = useLocalSearchParams<{
    mode?: string;
    returnToHistory?: string;
    historySection?: string;
  }>();
  const mode = personPickerMode(modeParam);
  const router = useRouter();
  const t = useT();
  const { guests, loading, refresh } = useGuests();
  const { profile } = useSelfProfile();
  const [guestsFailed, setGuestsFailed] = useState(false);
  const [patients, setPatients] = useState<SharedPatient[]>([]);
  const [sharedLoading, setSharedLoading] = useState(mode === 'history');
  const [sharedFailed, setSharedFailed] = useState(false);
  const request = useRef(0);
  const navigating = useRef(false);

  const loadPeople = useCallback(async () => {
    const current = ++request.current;
    setGuestsFailed(false);
    const owned = refresh().catch(() => {
      if (request.current === current) setGuestsFailed(true);
    });
    if (mode === 'history' && accountId) {
      setSharedLoading(true);
      setSharedFailed(false);
      try {
        const response = await fetchSharedPatients(accountId);
        if (request.current === current) {
          setPatients(response.patients.filter((patient) => patient.patient_id !== accountId));
        }
      } catch {
        if (request.current === current) {
          setPatients([]);
          setSharedFailed(true);
        }
      } finally {
        if (request.current === current) setSharedLoading(false);
      }
    } else setSharedLoading(false);
    await owned;
  }, [accountId, mode, refresh]);

  useFocusEffect(useCallback(() => {
    navigating.current = false;
    void loadPeople();
    return () => { ++request.current; };
  }, [loadPeople]));

  if (!mode) return <Redirect href="/" />;

  const select = (person: HistoryPerson) => {
    if (navigating.current) return;
    if (mode !== 'history' && person.kind === 'shared') return;
    navigating.current = true;
    if (mode === 'history') {
      const href = personHistoryHref(person, historySection === 'checkups' ? 'checkups' : 'tests');
      if (returnToHistory === '1') router.dismissTo(href);
      else router.push(href);
    } else {
      router.push(beginPersonTest(mode, person.kind === 'guest' ? person.id : undefined));
    }
  };

  const people: PersonRow[] = [
    { kind: 'me', key: 'me', name: profile?.name || t.resultsList.me },
    ...guests.map((guest) => ({ kind: 'guest' as const, id: guest.id, key: `guest:${guest.id}`, name: guest.name })),
    ...(mode === 'history' ? patients.map((patient) => ({
      kind: 'shared' as const,
      id: patient.patient_id,
      key: `shared:${patient.patient_id}`,
      name: patient.display_name || t.resultsList.unnamedPerson,
    })) : []),
  ];

  return (
    <Screen>
      <Header />
      <FlatList
        data={people}
        keyExtractor={(person) => person.key}
        contentContainerClassName="px-6 pb-8"
        ListHeaderComponent={
          <Text accessibilityRole="header" className="mb-7 text-[30px] font-semibold leading-[38px] text-ink">
            {mode === 'history' ? t.people.historyQuestion : mode === 'full' ? t.people.checkupQuestion : t.people.testQuestion}
          </Text>
        }
        renderItem={({ item, index }) => (
          <View>
            {item.kind === 'shared' && people[index - 1]?.kind !== 'shared' && (
              <Text accessibilityRole="header" className="mb-3 mt-5 text-[18px] font-semibold text-ink-muted">
                {t.people.sharedWithMe}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => select(item)}
              className="mb-3 min-h-[88px] flex-row items-center gap-4 rounded-3xl bg-ink-faint px-6 py-5 active:opacity-70"
            >
              <Text className="flex-1 text-[28px] font-semibold leading-[36px] text-ink">{item.name}</Text>
              <Ionicons name="chevron-forward" size={24} color={COLORS.ink} />
            </Pressable>
          </View>
        )}
        ListFooterComponent={
          <View className="gap-4 pt-3">
            {(loading || sharedLoading) && <ActivityIndicator color={COLORS.ink} />}
            {(guestsFailed || sharedFailed) && (
              <View className="gap-3">
                <Text className="text-[16px] leading-6 text-ink-muted">
                  {guestsFailed ? t.people.usersLoadFailed : t.people.sharedLoadFailed}
                </Text>
                <Button title={t.resultsList.tryAgain} variant="secondary" onPress={() => void loadPeople()} />
              </View>
            )}
            {mode !== 'history' && (
              <Button
                title={t.people.createUser}
                size="large"
                onPress={() => {
                  if (navigating.current) return;
                  navigating.current = true;
                  router.push({ pathname: '/guests/new', params: { mode } });
                }}
              />
            )}
          </View>
        }
      />
    </Screen>
  );
}
