import { apiFetch } from './api';

/** A person who approved the current account's permanent sharing code. */
export interface SharedPatient {
  patient_id: string;
  display_name: string | null;
  last_recorded_at: string | null;
}

export interface SharedPatientsResponse {
  patients: SharedPatient[];
}

export interface SharedTestType {
  id: string;
  display_name: string;
  updrs_item: string;
  unit: string;
  score_min: number;
  score_max: number;
  display_order: number;
}

export interface SharedTrialPoint {
  trial_id: number;
  recorded_at: string;
  /** Null while server-side analysis is still running or could not score. */
  score: number | null;
}

export interface SharedTrialsResponse {
  test_types: SharedTestType[];
  trials_by_test: Record<string, SharedTrialPoint[]>;
}

/** Flat list item used by the Previous recordings screen. */
export interface SharedRecording {
  trialId: number;
  ownerId: string;
  ownerName: string | null;
  testId: string;
  testName: string;
  updrsItem: string;
  unit: string;
  createdAt: number;
  score: number | null;
}

export interface SharedTrialDetail {
  trial_id: number;
  test_type_id: string;
  display_name: string;
  unit: string;
  updrs_item: string;
  recorded_at: string;
  score: number | null;
  analysis_status: string | null;
  updrs_grade: number | null;
  updrs_label: string | null;
  scoreable: boolean | null;
  video_url: string;
  expires_in: number;
  total_frames: number | null;
  duration_seconds: number | null;
}

export function fetchSharedPatients(): Promise<SharedPatientsResponse> {
  return apiFetch<SharedPatientsResponse>('/patients');
}

export function fetchSharedTrials(patientId: string): Promise<SharedTrialsResponse> {
  return apiFetch<SharedTrialsResponse>(
    `/patients/${encodeURIComponent(patientId)}/trials`,
  );
}

/** Fetch trial metadata and a fresh, short-lived signed video URL. */
export function fetchSharedTrialDetail(trialId: number): Promise<SharedTrialDetail> {
  return apiFetch<SharedTrialDetail>(`/trials/${trialId}`);
}

/** Convert the backend's grouped chart response into newest-first cards. */
export function flattenSharedTrials(
  owner: SharedPatient,
  response: SharedTrialsResponse,
): SharedRecording[] {
  const testTypes = new Map(response.test_types.map((test) => [test.id, test]));
  const recordings: SharedRecording[] = [];

  for (const [testId, points] of Object.entries(response.trials_by_test)) {
    const test = testTypes.get(testId);
    for (const point of points) {
      const createdAt = Date.parse(point.recorded_at);
      recordings.push({
        trialId: point.trial_id,
        ownerId: owner.patient_id,
        ownerName: owner.display_name,
        testId,
        testName: test?.display_name ?? testId,
        updrsItem: test?.updrs_item ?? '',
        unit: test?.unit ?? 'severity',
        createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
        score: point.score,
      });
    }
  }

  return recordings.sort((a, b) => b.createdAt - a.createdAt);
}
