import { apiFetch } from './api';
import type { EvaluatedSide } from './tests';
import type { EvaluationRunRef } from './types';

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
  updrs_grade?: number | null;
  analysis_status?: string | null;
  scoreable?: boolean | null;
  evaluated_side?: string | null;
  evaluation_run_id?: string | null;
  evaluation_run_started_at?: string | null;
  evaluation_run_expected_steps?: number | null;
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
  updrsGrade?: number | null;
  analysisStatus?: string | null;
  scoreable?: boolean | null;
  evaluatedSide?: EvaluatedSide;
  evaluationRun?: EvaluationRunRef;
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

export function fetchSharedPatients(expectedAccountId?: string): Promise<SharedPatientsResponse> {
  return expectedAccountId
    ? apiFetch<SharedPatientsResponse>('/patients', {}, expectedAccountId)
    : apiFetch<SharedPatientsResponse>('/patients');
}

export function fetchSharedTrials(patientId: string, expectedAccountId?: string): Promise<SharedTrialsResponse> {
  const path = `/patients/${encodeURIComponent(patientId)}/trials`;
  if (expectedAccountId) return apiFetch<SharedTrialsResponse>(path, {}, expectedAccountId);
  return apiFetch<SharedTrialsResponse>(path);
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
        updrsGrade: point.updrs_grade,
        analysisStatus: point.analysis_status,
        scoreable: point.scoreable,
        evaluatedSide: point.evaluated_side === 'left' || point.evaluated_side === 'right' ? point.evaluated_side : undefined,
        evaluationRun: point.evaluation_run_id ? {
          id: point.evaluation_run_id,
          startedAt: Date.parse(point.evaluation_run_started_at ?? '') || (Number.isNaN(createdAt) ? 0 : createdAt),
          expectedSteps: point.evaluation_run_expected_steps ?? 13,
        } : undefined,
      });
    }
  }

  return recordings.sort((a, b) => b.createdAt - a.createdAt);
}
