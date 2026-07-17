import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  Text,
  View,
} from 'react-native';

import { Header } from '../../components/Header';
import { RecordingCard } from '../../components/RecordingCard';
import { ResultsTrends, SharedResultsTrends } from '../../components/ResultsTrends';
import { Screen } from '../../components/Screen';
import { SharedRecordingCard } from '../../components/SharedRecordingCard';
import { useT } from '../../lib/i18n';
import {
  fetchSharedPatients,
  fetchSharedTrials,
  flattenSharedTrials,
  type SharedPatient,
  type SharedRecording,
} from '../../lib/sharedRecordings';
import { useRecordings } from '../../lib/storage';
import { COLORS } from '../../lib/theme';
import type { Recording } from '../../lib/types';

type ResultItem =
  | { kind: 'local'; recording: Recording }
  | { kind: 'shared'; recording: SharedRecording };

interface ResultSection {
  kind: 'local' | 'shared';
  data: ResultItem[];
}

/** Local recordings plus read-only recordings from people who accepted this account's code. */
export default function ResultsScreen() {
  const router = useRouter();
  const { recordings, loading, refresh: refreshOwnedRecordings } = useRecordings();
  const t = useT();

  const [patients, setPatients] = useState<SharedPatient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [sharedRecordings, setSharedRecordings] = useState<SharedRecording[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [trialsLoading, setTrialsLoading] = useState(false);
  const [sharedError, setSharedError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const patientsRequest = useRef(0);
  const trialsRequest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadTrials = useCallback(async (patient: SharedPatient) => {
    const request = ++trialsRequest.current;
    setTrialsLoading(true);
    setSharedError(false);
    try {
      const response = await fetchSharedTrials(patient.patient_id);
      if (!mounted.current || request !== trialsRequest.current) return;
      setSharedRecordings(flattenSharedTrials(patient, response));
    } catch {
      if (!mounted.current || request !== trialsRequest.current) return;
      setSharedRecordings([]);
      setSharedError(true);
    } finally {
      if (mounted.current && request === trialsRequest.current) setTrialsLoading(false);
    }
  }, []);

  const loadPatients = useCallback(
    async (preferredPatientId?: string | null) => {
      const request = ++patientsRequest.current;
      setPatientsLoading(true);
      setSharedError(false);
      try {
        const response = await fetchSharedPatients();
        if (!mounted.current || request !== patientsRequest.current) return;
        setPatients(response.patients);
        const selected = preferredPatientId
          ? response.patients.find((patient) => patient.patient_id === preferredPatientId) ?? null
          : null;
        setSelectedPatientId(selected?.patient_id ?? null);
        if (selected) {
          await loadTrials(selected);
        } else {
          ++trialsRequest.current;
          setSharedRecordings([]);
          setTrialsLoading(false);
        }
      } catch {
        if (!mounted.current || request !== patientsRequest.current) return;
        setSharedError(true);
      } finally {
        if (mounted.current && request === patientsRequest.current) setPatientsLoading(false);
      }
    },
    [loadTrials],
  );

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  const selectPatient = (patient: SharedPatient) => {
    if (patient.patient_id === selectedPatientId) return;
    setSelectedPatientId(patient.patient_id);
    setSharedRecordings([]);
    void loadTrials(patient);
  };

  const selectMe = () => {
    if (selectedPatientId === null) return;
    ++trialsRequest.current;
    setSelectedPatientId(null);
    setSharedRecordings([]);
    setTrialsLoading(false);
    setSharedError(false);
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadPatients(selectedPatientId),
      refreshOwnedRecordings().catch(() => {}),
    ]);
    if (mounted.current) setRefreshing(false);
  };

  const sections: ResultSection[] = [];
  if (selectedPatientId && sharedRecordings.length > 0) {
    sections.push({
      kind: 'shared',
      data: sharedRecordings.map((recording) => ({ kind: 'shared', recording })),
    });
  }
  if (!selectedPatientId && recordings.length > 0) {
    sections.push({
      kind: 'local',
      data: recordings.map((recording) => ({ kind: 'local', recording })),
    });
  }

  const selectedPatient = patients.find((patient) => patient.patient_id === selectedPatientId);
  const selectedLoading = selectedPatientId ? trialsLoading : loading;

  const ownerSwitcher = (
    <View className="px-6 pb-4">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 py-3"
      >
        <Pressable
          onPress={selectMe}
          accessibilityRole="button"
          accessibilityState={{ selected: selectedPatientId === null }}
          accessibilityLabel={t.resultsList.selectPerson(t.resultsList.me)}
          className={`rounded-full border px-4 py-2.5 active:opacity-70 ${
            selectedPatientId === null ? 'border-ink bg-ink' : 'border-ink-faint bg-white'
          }`}
        >
          <Text
            className={`text-[14px] font-semibold ${
              selectedPatientId === null ? 'text-white' : 'text-ink'
            }`}
          >
            {t.resultsList.me}
          </Text>
        </Pressable>

        {patients.map((patient) => {
          const selected = patient.patient_id === selectedPatientId;
          const name = patient.display_name || t.resultsList.unnamedPerson;
          return (
            <Pressable
              key={patient.patient_id}
              onPress={() => selectPatient(patient)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t.resultsList.selectPerson(name)}
              className={`rounded-full border px-4 py-2.5 active:opacity-70 ${
                selected ? 'border-ink bg-ink' : 'border-ink-faint bg-white'
              }`}
            >
              <Text className={`text-[14px] font-semibold ${selected ? 'text-white' : 'text-ink'}`}>
                {name}
              </Text>
            </Pressable>
          );
        })}

        {patientsLoading && <ActivityIndicator className="mx-2" color={COLORS.ink} />}
      </ScrollView>

      {!patientsLoading && patients.length === 0 && (
        <Text className="mt-1 text-[14px] leading-5 text-ink-muted">
          {t.resultsList.noSharedPeople}
        </Text>
      )}

      {sharedError && (
        <View className="mt-2 rounded-2xl border border-red-200 bg-red-50 p-4">
          <Text className="text-[14px] leading-5 text-red-700">{t.resultsList.sharedLoadError}</Text>
          <Pressable
            onPress={() => void loadPatients(selectedPatientId)}
            accessibilityRole="button"
            className="mt-2 self-start active:opacity-60"
          >
            <Text className="text-[14px] font-semibold text-red-700">{t.resultsList.tryAgain}</Text>
          </Pressable>
        </View>
      )}

      {trialsLoading && selectedPatientId && (
        <View className="mt-2 flex-row items-center gap-3">
          <ActivityIndicator color={COLORS.ink} />
          <Text className="text-[14px] text-ink-muted">{t.resultsList.loadingRecordings}</Text>
        </View>
      )}
    </View>
  );

  return (
    <Screen>
      <Header title={t.resultsList.title} />

      <SectionList<ResultItem, ResultSection>
        sections={sections}
        keyExtractor={(item) =>
          item.kind === 'local' ? `local-${item.recording.id}` : `shared-${item.recording.trialId}`
        }
        stickySectionHeadersEnabled={false}
        contentContainerClassName="flex-grow pb-8"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListHeaderComponent={ownerSwitcher}
        renderSectionHeader={({ section }) => (
          <View className="bg-white px-6 pb-3 pt-1">
            <Text className="text-[16px] font-semibold text-ink">
              {section.kind === 'shared'
                ? selectedPatient?.display_name || t.resultsList.unnamedPerson
                : t.resultsList.yourRecordings}
            </Text>
            {section.kind === 'local' && (
              <View className="mt-3">
                <ResultsTrends recordings={recordings} />
              </View>
            )}
            {section.kind === 'shared' && selectedPatient && (
              <View className="mt-3">
                <SharedResultsTrends
                  recordings={sharedRecordings}
                  ownerName={selectedPatient.display_name || t.resultsList.unnamedPerson}
                />
              </View>
            )}
          </View>
        )}
        renderItem={({ item }) => (
          <View className="px-6">
            {item.kind === 'local' ? (
              <View className="mb-3">
                <RecordingCard
                  recording={item.recording}
                  onPress={() =>
                    router.push({ pathname: '/results/[id]', params: { id: item.recording.id } })
                  }
                />
              </View>
            ) : (
              <SharedRecordingCard
                recording={item.recording}
                onPress={() =>
                  router.push({
                    pathname: '/shared/[id]',
                    params: {
                      id: String(item.recording.trialId),
                      ownerName: item.recording.ownerName || t.resultsList.unnamedPerson,
                    },
                  })
                }
              />
            )}
          </View>
        )}
        ListEmptyComponent={
          selectedLoading ? (
            <View className="flex-1 items-center justify-center py-12">
              <ActivityIndicator color={COLORS.ink} />
            </View>
          ) : (
            <View className="flex-1 items-center justify-center px-10 py-12">
              <MaterialCommunityIcons name="video-off-outline" size={52} color={COLORS.inkFaint} />
              <Text className="mt-4 text-center text-[17px] font-semibold text-ink">
                {selectedPatientId ? t.resultsList.noSharedRecordings : t.resultsList.emptyTitle}
              </Text>
              {!selectedPatientId && (
                <Text className="mt-1 text-center text-[14px] text-ink-muted">
                  {t.resultsList.emptyBody}
                </Text>
              )}
            </View>
          )
        }
      />
    </Screen>
  );
}
