import { apiFetch } from './api';
import { getTest, type EvaluatedSide, type TestId } from './tests';
import type { CloudResult, Recording, RecordingStatus } from './types';

export const LOCAL_VIDEO_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export interface OwnedTrialSummary {
  trial_id: number;
  client_trial_id: string;
  test_type_id: string;
  recorded_at: string;
  score: number | null;
  updrs_grade: number | null;
  updrs_label: string | null;
  analysis_status: string | null;
  analysis_error: string | null;
  scoreable: boolean | null;
  is_estimate: boolean | null;
  confidence: string | null;
  evaluated_side: string | null;
  quality_failures: string[];
}

interface OwnedTrialsResponse {
  trials: OwnedTrialSummary[];
}

export function fetchOwnedTrials(): Promise<OwnedTrialsResponse> {
  return apiFetch<OwnedTrialsResponse>('/me/trials');
}

const LABELS = ['Normal', 'Slight', 'Mild', 'Moderate', 'Severe'];

function fallbackLabel(score: number): string {
  return LABELS[Math.min(LABELS.length - 1, Math.max(0, Math.floor(score * LABELS.length)))];
}

function testId(value: string): TestId | null {
  return getTest(value)?.id ?? null;
}

function evaluatedSide(value: string | null): EvaluatedSide | undefined {
  return value === 'left' || value === 'right' ? value : undefined;
}

function statusFor(trial: OwnedTrialSummary): RecordingStatus {
  if (trial.analysis_status === 'needs_retry' || trial.scoreable === false) return 'needs_retry';
  if (trial.analysis_status === 'failed') return 'failed';
  if (trial.analysis_status === 'done' && trial.score != null) return 'done';
  return 'processing';
}

function resultFor(trial: OwnedTrialSummary): CloudResult | undefined {
  if (trial.score == null) return undefined;
  return {
    score: trial.score,
    label: trial.updrs_label ?? fallbackLabel(trial.score),
    isDemo: false,
    isEstimate: trial.is_estimate ?? true,
    updrsGrade: trial.updrs_grade ?? undefined,
    confidence: trial.confidence ?? undefined,
  };
}

function remoteRecording(
  trial: OwnedTrialSummary,
  local: Recording | undefined,
  now: number,
): Recording | null {
  const validTestId = testId(trial.test_type_id);
  if (!validTestId) return null;
  const parsedTime = Date.parse(trial.recorded_at);
  const createdAt = Number.isFinite(parsedTime) ? parsedTime : local?.createdAt ?? now;
  const keepLocalVideo = now - createdAt < LOCAL_VIDEO_RETENTION_MS;
  const status = statusFor(trial);

  return {
    id: trial.client_trial_id || local?.id || `server-${trial.trial_id}`,
    testId: validTestId,
    evaluatedSide: evaluatedSide(trial.evaluated_side) ?? local?.evaluatedSide,
    createdAt,
    videoUri: keepLocalVideo ? local?.videoUri : undefined,
    faceBlurOriginalUri: keepLocalVideo ? local?.faceBlurOriginalUri : undefined,
    status,
    faceBlurRequested: local?.faceBlurRequested,
    faceBlurState: local?.faceBlurState,
    faceBlurFramesProcessed: local?.faceBlurFramesProcessed,
    faceBlurFramesWithFaces: local?.faceBlurFramesWithFaces,
    faceBlurDetections: local?.faceBlurDetections,
    jobId: String(trial.trial_id),
    result: resultFor(trial),
    failReason: status === 'failed' ? trial.analysis_error ?? 'analysis failed' : undefined,
    analysisFailureReasons: status === 'needs_retry' ? trial.quality_failures : undefined,
    permanent: status === 'failed' ? false : undefined,
    resumable: status === 'failed' ? false : undefined,
  };
}

export interface RecordingMergeResult {
  recordings: Recording[];
  /** App-owned local files no longer referenced by the merged history. */
  localUrisToDelete: string[];
}

/**
 * Merge server truth with local upload state.
 *
 * - Local-only recordings are retained so interrupted uploads remain retryable.
 * - Server rows replace matching local metadata and appear on every device.
 * - Uploaded local clips remain available for three days, then become
 *   cloud-on-demand records.
 * - Server-backed rows absent from a successful server response were deleted
 *   elsewhere and are removed locally too.
 */
export function mergeOwnedTrials(
  localRecordings: Recording[],
  trials: OwnedTrialSummary[],
  now: number = Date.now(),
): RecordingMergeResult {
  const localByClientId = new Map(localRecordings.map((recording) => [recording.id, recording]));
  const localByTrialId = new Map(
    localRecordings
      .filter((recording) => recording.jobId)
      .map((recording) => [recording.jobId!, recording]),
  );
  const matchedLocalIds = new Set<string>();
  const recordings: Recording[] = [];
  const localUrisToDelete = new Set<string>();

  for (const trial of trials) {
    const local = localByClientId.get(trial.client_trial_id) ?? localByTrialId.get(String(trial.trial_id));
    if (local) matchedLocalIds.add(local.id);
    const merged = remoteRecording(trial, local, now);
    if (!merged) continue;
    if (local?.videoUri && !merged.videoUri) localUrisToDelete.add(local.videoUri);
    recordings.push(merged);
  }

  for (const local of localRecordings) {
    if (matchedLocalIds.has(local.id)) continue;
    if (local.jobId) {
      if (local.videoUri) localUrisToDelete.add(local.videoUri);
      continue;
    }
    recordings.push(local);
  }

  recordings.sort((a, b) => b.createdAt - a.createdAt);
  return { recordings, localUrisToDelete: [...localUrisToDelete] };
}
