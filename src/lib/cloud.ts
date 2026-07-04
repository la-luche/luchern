import * as FileSystem from 'expo-file-system/legacy';

import { apiFetch } from './api';
import type { CloudResult } from './types';
import type { TestId } from './tests';
import { PollTimeoutError } from './uploadRetry';

/**
 * Cloud client — the ONE module that talks to the backend. Real pipeline:
 *
 *   uploadRecording()  request presigned R2 PUT → upload the clip → create a
 *                      trial in `analyze` mode (server computes the score).
 *   pollResult()       poll the trial until the keypoint→MDS-UPDRS worker
 *                      finishes, then return the score.
 *
 * The backend runs Sapiens2 keypoint detection + a kinematic heuristic; scores
 * are real (not demo) but flagged `isEstimate`. UI, persistence, and status
 * pills are unchanged.
 */

// Poll cadence + ceiling. Warm jobs finish in ~1 min; a cold GPU worker can take
// up to ~13 min, so we poll patiently. Interrupted polls resume on relaunch.
const POLL_INTERVAL_MS = 3000;
// Must exceed the worker's WORKER_JOB_TIMEOUT_SECONDS (25 min) so a cold GPU
// job that finishes late isn't turned into a false client-side failure.
const POLL_MAX_MS = 30 * 60 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RequestUrlResp {
  upload_url: string;
  upload_id: string;
}
interface CreateTrialResp {
  trial_id: number;
  analysis_status?: string;
}
interface TrialDetail {
  analysis_status?: string | null;
  score: number | null;
  updrs_grade: number | null;
  updrs_label: string | null;
  is_estimate?: boolean | null;
  confidence?: string | null;
}

/**
 * Upload the clip and open a server-scored trial. Returns the trial id (used as
 * the poll handle). testId + clientTrialId come from the local recording.
 */
export async function uploadRecording(
  videoUri: string,
  testId: TestId,
  clientTrialId: string,
  recordedAtMs: number,
): Promise<{ jobId: string }> {
  const info = await FileSystem.getInfoAsync(videoUri);
  if (!info.exists) throw new Error('recording file missing');
  const sizeBytes = (info as { size?: number }).size ?? 0;

  // 1. Presigned upload URL (server owns the R2 key).
  const req = await apiFetch<RequestUrlResp>('/uploads/request-url', {
    method: 'POST',
    body: JSON.stringify({ test_type_id: testId, size_bytes: sizeBytes }),
  });

  // 2. PUT the raw bytes straight to R2. Content-Type must match the presign.
  const put = await FileSystem.uploadAsync(req.upload_url, videoUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': 'video/mp4' },
  });
  if (put.status < 200 || put.status >= 300) {
    throw new Error(`upload failed (${put.status})`);
  }

  // 3. Create the trial in analyze mode → enqueues keypoint analysis.
  const trial = await apiFetch<CreateTrialResp>('/trials', {
    method: 'POST',
    body: JSON.stringify({
      upload_id: req.upload_id,
      test_type_id: testId,
      recorded_at: new Date(recordedAtMs).toISOString(),
      client_trial_id: clientTrialId,
      analyze: true,
    }),
  });

  return { jobId: String(trial.trial_id) };
}

/** Poll the trial until the analysis worker finishes; resolve with the score. */
export async function pollResult(jobId: string, _testId: TestId): Promise<CloudResult> {
  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    let t: TrialDetail;
    try {
      t = await apiFetch<TrialDetail>(`/trials/${jobId}`);
    } catch {
      // Transient poll error (e.g. 5xx during GPU cold start): keep polling
      // until the real deadline rather than collapsing a blip into a failure.
      await delay(POLL_INTERVAL_MS);
      continue;
    }
    if (t.analysis_status === 'done' && t.score != null) {
      return {
        score: t.score,
        label: t.updrs_label ?? severityLabel(t.score),
        isDemo: false,
        isEstimate: t.is_estimate ?? true,
        updrsGrade: t.updrs_grade ?? undefined,
        confidence: t.confidence ?? undefined,
      };
    }
    if (t.analysis_status === 'failed') {
      throw new Error('analysis failed');
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new PollTimeoutError();
}

const LABELS = ['Normal', 'Slight', 'Mild', 'Moderate', 'Severe'];
function severityLabel(score: number): string {
  return LABELS[Math.min(LABELS.length - 1, Math.max(0, Math.floor(score * LABELS.length)))];
}
