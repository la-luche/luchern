import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { fetchSharedPatients, fetchSharedTrials, flattenSharedTrials, type SharedRecording } from './sharedRecordings';

/** Caller keys its screen by account/person so no previous subject flashes on a switch. */
export function useSharedHistory(accountId: string | undefined, patientId: string) {
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<SharedRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const inFlight = useRef(false);
  const refresh = useCallback(async (silent = false) => {
    if (silent && inFlight.current) return;
    const current = ++request.current;
    inFlight.current = true;
    if (!silent) setLoading(true);
    setFailed(false);
    let accessUnavailable = false;
    try {
      if (!accountId) { accessUnavailable = true; throw new Error('account unavailable'); }
      const response = await fetchSharedPatients(accountId);
      if (current !== request.current) return;
      const patient = response.patients.find((candidate) => candidate.patient_id === patientId);
      if (!patient) { accessUnavailable = true; throw new Error('sharing access unavailable'); }
      setOwnerName(patient.display_name);
      const trials = await fetchSharedTrials(patientId, accountId);
      if (current === request.current) setRecordings(flattenSharedTrials(patient, trials));
    } catch (error) {
      if (current === request.current) {
        const status = (error as { status?: number } | null)?.status;
        // Keep this person's already-loaded results through a transient outage.
        // A confirmed permission loss clears them immediately and stops polling.
        if (accessUnavailable || status === 401 || status === 403 || status === 404) setRecordings([]);
        setFailed(true);
      }
    } finally {
      if (current === request.current) { setLoading(false); inFlight.current = false; }
    }
  }, [accountId, patientId]);
  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { ++request.current; inFlight.current = false; };
  }, [refresh]));
  useFocusEffect(useCallback(() => {
    const pending = recordings.some((recording) => recording.scoreable !== false &&
      (['queued', 'processing', 'running'].includes(recording.analysisStatus ?? '') ||
        (recording.analysisStatus == null && recording.score == null)));
    if (!pending) return;
    const timer = setInterval(() => void refresh(true), 10_000);
    return () => clearInterval(timer);
  }, [recordings, refresh]));
  return { ownerName, recordings, loading, failed, refresh };
}
