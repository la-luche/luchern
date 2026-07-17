import * as FileSystem from 'expo-file-system/legacy';

import { ApiError, apiFetch } from './api';
import { diagnosticErrorData, recordDiagnostic } from './diagnostics';
import type { CloudResult } from './types';
import type { EvaluatedSide, TestId } from './tests';
import {
  OperationCancelledError,
  PollTimeoutError,
  cancellableDelay,
  throwIfCancelled,
} from './uploadRetry';

/**
 * Cloud client — the ONE module that talks to the backend. Real pipeline:
 *
 *   uploadRecording()  request presigned R2 PUT → upload the clip.
 *   createAnalysisTrial() persist the uploaded object as an analysis job.
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
  scoreable?: boolean | null;
  capture_quality?: string | null;
  submetrics?: {
    quality_failures?: unknown;
  } | null;
}

export class UploadIntentExpiredError extends Error {
  constructor() {
    super('upload authorization expired');
    this.name = 'UploadIntentExpiredError';
  }
}

/** Terminal quality rejection: analysis completed, but this capture cannot be
 * scored. Re-running the same video cannot help; the user needs to record a new
 * clip. `reasons` preserves the backend's quality diagnostics for the UI. */
export class AnalysisNeedsRetryError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`analysis returned no score: ${reasons.join(', ')}`);
    this.name = 'AnalysisNeedsRetryError';
  }
}

function noScoreReasons(trial: TrialDetail): string[] {
  const raw = trial.submetrics?.quality_failures;
  const reasons = Array.isArray(raw)
    ? raw.filter((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0)
    : [];
  return reasons.length > 0 ? [...new Set(reasons)] : ['insufficient_capture_quality'];
}

/**
 * Upload only the video bytes. The returned upload id is persisted locally
 * before the separate createAnalysisTrial call, so a transient API failure
 * never forces the large file to be sent again.
 */
export async function uploadRecording(
  videoUri: string,
  testId: TestId,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ uploadId: string }> {
  throwIfCancelled(signal);
  const info = await FileSystem.getInfoAsync(videoUri);
  if (!info.exists) throw new Error('recording file missing');
  const sizeBytes = (info as { size?: number }).size ?? 0;
  const startedAt = Date.now();
  recordDiagnostic('upload_preparing', { testId, sizeBytes });

  // 1. Presigned upload URL (server owns the R2 key).
  const presignStartedAt = Date.now();
  const req = await apiFetch<RequestUrlResp>('/uploads/request-url', {
    method: 'POST',
    body: JSON.stringify({ test_type_id: testId, size_bytes: sizeBytes }),
    signal,
  });
  throwIfCancelled(signal);
  recordDiagnostic('upload_url_ready', {
    uploadId: req.upload_id,
    sizeBytes,
    elapsedMs: Date.now() - presignStartedAt,
  });

  // 2. PUT the raw bytes straight to R2. Content-Type must match the presign.
  // Use the immediate foreground URLSession. Durable local state restarts a
  // failed transfer after foreground/relaunch, while iOS background sessions
  // can perform opaque whole-file retries whose progress jumps backwards.
  let highestProgress = 0;
  let firstByteSeen = false;
  let stalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelUpload = () => {};
  const armStallWatchdog = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      cancelUpload();
    }, 45_000);
  };
  const task = FileSystem.createUploadTask(req.upload_url, videoUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
    headers: { 'Content-Type': 'video/mp4' },
  }, ({ totalBytesSent, totalBytesExpectedToSend }) => {
    armStallWatchdog();
    if (!firstByteSeen && totalBytesSent > 0) {
      firstByteSeen = true;
      recordDiagnostic('r2_upload_first_byte', {
        uploadId: req.upload_id,
        elapsedMs: Date.now() - startedAt,
      });
    }
    if (totalBytesExpectedToSend > 0) {
      highestProgress = Math.max(
        highestProgress,
        Math.max(0, Math.min(1, totalBytesSent / totalBytesExpectedToSend)),
      );
      onProgress?.(highestProgress);
    }
  });
  cancelUpload = () => { void task.cancelAsync().catch(() => {}); };
  const onAbort = () => cancelUpload();
  signal?.addEventListener('abort', onAbort, { once: true });
  armStallWatchdog();
  let put;
  try {
    put = await task.uploadAsync();
  } catch (error) {
    if (stallTimer) clearTimeout(stallTimer);
    recordDiagnostic('r2_upload_failed', {
      uploadId: req.upload_id,
      ...diagnosticErrorData(error),
    });
    if (signal?.aborted) throw new OperationCancelledError();
    if (stalled) throw new Error('upload stalled for 45 seconds');
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (stallTimer) clearTimeout(stallTimer);
  if (!put) throw new Error('upload interrupted');
  if (put.status < 200 || put.status >= 300) {
    const r2Code = put.body?.match(/<Code>([^<]{1,80})<\/Code>/)?.[1];
    recordDiagnostic('r2_upload_failed', {
      uploadId: req.upload_id,
      status: put.status,
      ...(r2Code ? { r2Code } : {}),
    });
    throw new Error(`upload failed (${put.status})`);
  }
  onProgress?.(1);
  const elapsedMs = Math.max(1, Date.now() - startedAt);
  recordDiagnostic('r2_upload_completed', {
    uploadId: req.upload_id,
    sizeBytes,
    elapsedMs,
    kbps: Math.round((sizeBytes * 8) / elapsedMs),
  });
  return { uploadId: req.upload_id };
}

/** Convert an already-uploaded object into a server analysis job. */
export async function createAnalysisTrial(
  uploadId: string,
  testId: TestId,
  clientTrialId: string,
  recordedAtMs: number,
  evaluatedSide?: EvaluatedSide,
  signal?: AbortSignal,
): Promise<{ jobId: string }> {
  throwIfCancelled(signal);
  try {
    const trial = await apiFetch<CreateTrialResp>('/trials', {
      method: 'POST',
      body: JSON.stringify({
        upload_id: uploadId,
        test_type_id: testId,
        recorded_at: new Date(recordedAtMs).toISOString(),
        metadata: evaluatedSide ? { evaluated_side: evaluatedSide } : {},
        client_trial_id: clientTrialId,
        analyze: true,
      }),
      signal,
    });

    return { jobId: String(trial.trial_id) };
  } catch (error) {
    // A pending upload intent expires after its presigned URL TTL. The caller
    // must mint a fresh intent and re-upload; retrying this same id cannot work.
    if (error instanceof ApiError && error.status === 403) {
      throw new UploadIntentExpiredError();
    }
    throw error;
  }
}

/** Delete the owning patient's trial and its server-held video/keypoints. */
export async function deleteRemoteRecording(jobId: string): Promise<void> {
  try {
    await apiFetch<{ status: string }>(`/trials/${jobId}`, { method: 'DELETE' });
  } catch (error) {
    // The endpoint intentionally uses a generic 403 for missing/foreign ids.
    // For an id from this local store, missing means a prior delete succeeded.
    if (error instanceof ApiError && error.status === 403) return;
    throw error;
  }
}

/** Delete bytes that reached R2 but have not yet been converted into a trial. */
export async function deleteRemoteUpload(uploadId: string): Promise<'deleted' | 'consumed'> {
  try {
    await apiFetch<{ status: string }>(`/uploads/${uploadId}`, { method: 'DELETE' });
    return 'deleted';
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return 'consumed';
    if (error instanceof ApiError && error.status === 403) return 'deleted';
    throw error;
  }
}

/** Poll the trial until the analysis worker finishes; resolve with the score or
 * throw a terminal AnalysisNeedsRetryError when capture quality prevented one. */
export async function pollResult(
  jobId: string,
  _testId: TestId,
  signal?: AbortSignal,
): Promise<CloudResult> {
  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    throwIfCancelled(signal);
    let t: TrialDetail;
    try {
      t = await apiFetch<TrialDetail>(`/trials/${jobId}`, { signal });
    } catch (error) {
      throwIfCancelled(signal);
      // Auth/ownership/not-found failures will not heal by polling. Network,
      // throttling, and 5xx errors remain transient until the real deadline.
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        throw error;
      }
      // Transient poll error (e.g. 5xx during GPU cold start): keep polling
      // until the real deadline rather than collapsing a blip into a failure.
      await cancellableDelay(POLL_INTERVAL_MS, signal);
      continue;
    }
    if (t.analysis_status === 'needs_retry' || t.scoreable === false) {
      throw new AnalysisNeedsRetryError(noScoreReasons(t));
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
    await cancellableDelay(POLL_INTERVAL_MS, signal);
  }
  throw new PollTimeoutError();
}

const LABELS = ['Normal', 'Slight', 'Mild', 'Moderate', 'Severe'];
function severityLabel(score: number): string {
  return LABELS[Math.min(LABELS.length - 1, Math.max(0, Math.floor(score * LABELS.length)))];
}
