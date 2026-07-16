import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  UploadIntentExpiredError,
  createAnalysisTrial,
  deleteRemoteRecording,
  deleteRemoteUpload,
  pollResult,
  uploadRecording,
} from './cloud';
import { ApiError } from './api';
import { diagnosticErrorData, recordDiagnostic } from './diagnostics';
import { deleteRecordingFile, persistRecordingFile } from './recordingFiles';
import type { TestId } from './tests';
import type { Recording } from './types';
import {
  PollTimeoutError,
  UPLOAD_BACKOFFS_MS,
  classifyUploadError,
  createSerialQueue,
} from './uploadRetry';

const STORAGE_KEY = 'luche.recordings.v1';

// --- Module-level shared store -------------------------------------------------
// A single in-memory cache backed by AsyncStorage, with a tiny subscription
// system so every mounted useRecordings() hook re-renders on any change. Avoids
// each screen holding a divergent copy of the list.

let cache: Recording[] | null = null;
let loadPromise: Promise<Recording[]> | null = null;
let persistTail: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
// Guards against driving the same recording's pipeline twice concurrently.
const inFlight = new Set<string>();

// One byte-upload at a time — parallel uploads compete on weak uplinks and all
// slow past the presign TTL.
const serialUpload = createSerialQueue();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Attempt the upload with in-session exponential backoff. `maxBackoffs` is the
 *  number of retries after the first try (defaults to the full schedule; tests
 *  pass 0). Permanent errors abort immediately. Returns the upload id. */
async function uploadWithRetry(
  rec: Recording,
  maxBackoffs: number = UPLOAD_BACKOFFS_MS.length,
  onProgress?: (fraction: number) => void,
  onAttempt?: (attempt: number) => void,
  onRetry?: (nextAttempt: number, delayMs: number) => void,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxBackoffs; attempt++) {
    try {
      onAttempt?.(attempt + 1);
      onProgress?.(0);
      const res = await uploadRecording(rec.videoUri, rec.testId, onProgress);
      return res.uploadId;
    } catch (e) {
      lastErr = e;
      recordDiagnostic('upload_attempt_failed', {
        recordingId: rec.id,
        attempt: attempt + 1,
        ...diagnosticErrorData(e),
      });
      if (classifyUploadError(e) === 'permanent') throw e;
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408 &&
        e.status !== 429
      ) throw e;
      if (attempt < maxBackoffs) {
        const retryDelay = UPLOAD_BACKOFFS_MS[attempt] + Math.floor(Math.random() * 1000);
        onRetry?.(attempt + 2, retryDelay);
        await delay(retryDelay);
      }
    }
  }
  throw lastErr;
}

/** Retry only the small idempotent trial-creation request. The video bytes have
 * already reached R2 and are never resent for a transient API error. */
async function createTrialWithRetry(
  rec: Recording,
  uploadId: string,
  maxBackoffs: number = UPLOAD_BACKOFFS_MS.length,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxBackoffs; attempt++) {
    try {
      const res = await createAnalysisTrial(uploadId, rec.testId, rec.id, rec.createdAt);
      return res.jobId;
    } catch (e) {
      lastErr = e;
      recordDiagnostic('trial_submit_failed', {
        recordingId: rec.id,
        uploadId,
        attempt: attempt + 1,
        ...diagnosticErrorData(e),
      });
      if (e instanceof UploadIntentExpiredError) throw e;
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408 &&
        e.status !== 422 &&
        e.status !== 429
      ) throw e;
      if (attempt < maxBackoffs) {
        await delay(UPLOAD_BACKOFFS_MS[attempt] + Math.floor(Math.random() * 1000));
      }
    }
  }
  throw lastErr;
}

function emit() {
  for (const l of listeners) l();
}

async function persist() {
  const snapshot = JSON.stringify(cache ?? []);
  const write = persistTail.then(() => AsyncStorage.setItem(STORAGE_KEY, snapshot));
  persistTail = write.catch(() => {});
  await write;
}

async function ensureLoaded(): Promise<Recording[]> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      cache = raw ? (JSON.parse(raw) as Recording[]) : [];
      return cache;
    });
  }
  return loadPromise;
}

function makeId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

async function patch(id: string, partial: Partial<Recording>) {
  const list = await ensureLoaded();
  cache = list.map((r) => (r.id === id ? { ...r, ...partial } : r));
  await persist();
  emit();
}

/** Update transient UI state without hammering AsyncStorage on every progress event. */
function patchVolatile(id: string, partial: Partial<Recording>) {
  if (!cache) return;
  cache = cache.map((r) => (r.id === id ? { ...r, ...partial } : r));
  emit();
}

/** Pure lifecycle core: runs the upload→poll for one recording and RETURNS the
 *  patch to apply. No persistence, so it's unit-testable. `opts.maxBackoffs`
 *  lets tests disable backoff. */
async function driveOnce(
  rec: Recording,
  opts: {
    maxBackoffs?: number;
    onBytesUploaded?: (uploadId: string) => Promise<void> | void;
    onUploadExpired?: () => Promise<void> | void;
    onTrialCreated?: (jobId: string) => Promise<void> | void;
    onUploadProgress?: (fraction: number) => void;
    onUploadAttempt?: (attempt: number) => void;
    onUploadRetry?: (nextAttempt: number, delayMs: number) => void;
  } = {},
): Promise<Partial<Recording>> {
  let jobId = rec.jobId;
  let uploadId = rec.uploadId;
  let phase: 'upload' | 'submit' | 'poll' = uploadId ? 'submit' : 'upload';
  try {
    if (!jobId) {
      // One expired intent recovery is performed immediately. More than one
      // indicates a persistent server/clock problem and surfaces for retry.
      for (let intentAttempt = 0; intentAttempt < 2; intentAttempt++) {
        if (!uploadId) {
          phase = 'upload';
          uploadId = await serialUpload(() =>
            uploadWithRetry(
              rec,
              opts.maxBackoffs,
              opts.onUploadProgress,
              opts.onUploadAttempt,
              opts.onUploadRetry,
            ),
          );
          // Persist this boundary before the tiny create-trial request. A kill
          // from here onward resumes without retransmitting the video.
          await opts.onBytesUploaded?.(uploadId);
        }
        phase = 'submit';
        try {
          jobId = await createTrialWithRetry(rec, uploadId, opts.maxBackoffs);
          await opts.onTrialCreated?.(jobId);
          break;
        } catch (error) {
          if (error instanceof UploadIntentExpiredError && intentAttempt === 0) {
            uploadId = undefined;
            await opts.onUploadExpired?.();
            continue;
          }
          throw error;
        }
      }
      if (!jobId) throw new Error('trial creation failed');
    }
    phase = 'poll';
    const result = await pollResult(jobId, rec.testId);
    return {
      status: 'done',
      uploadId,
      uploadProgress: undefined,
      uploadAttempt: undefined,
      uploadRetrying: undefined,
      jobId,
      result,
    };
  } catch (e) {
    if (e instanceof PollTimeoutError) {
      // Server may still finish — keep processing so resumePending re-polls.
      return {
        status: 'processing',
        uploadId,
        uploadProgress: undefined,
        uploadAttempt: undefined,
        uploadRetrying: undefined,
        jobId,
      };
    }
    const permanent = classifyUploadError(e) === 'permanent';
    return {
      status: 'failed',
      failReason: e instanceof Error ? e.message : String(e),
      uploadId,
      uploadProgress: undefined,
      uploadAttempt: undefined,
      uploadRetrying: undefined,
      permanent,
      resumable: phase !== 'poll' && !permanent,
    };
  }
}

/** Persisting wrapper: guards against double-driving, marks 'processing' as
 *  soon as the upload succeeds, then applies the final patch. */
async function drive(rec: Recording) {
  if (inFlight.has(rec.id)) return;
  inFlight.add(rec.id);
  try {
    const patch_ = await driveOnce(rec, {
      onUploadProgress: (uploadProgress) => patchVolatile(rec.id, { uploadProgress }),
      onUploadAttempt: (uploadAttempt) => patchVolatile(rec.id, {
        uploadAttempt,
        uploadRetrying: false,
        uploadProgress: 0,
      }),
      onUploadRetry: (uploadAttempt, delayMs) => {
        patchVolatile(rec.id, { uploadAttempt, uploadRetrying: true, uploadProgress: 0 });
        recordDiagnostic('upload_retry_scheduled', {
          recordingId: rec.id,
          attempt: uploadAttempt,
          delayMs,
        });
      },
      onBytesUploaded: (uploadId) =>
        patch(rec.id, {
          status: 'processing',
          uploadId,
          uploadProgress: undefined,
          uploadAttempt: undefined,
          uploadRetrying: undefined,
        }).then(() => {
          recordDiagnostic('upload_completed', { recordingId: rec.id, uploadId });
        }),
      onUploadExpired: () =>
        patch(rec.id, {
          status: 'uploading',
          uploadId: undefined,
          uploadProgress: 0,
          uploadAttempt: undefined,
          uploadRetrying: undefined,
        }).then(() => {
          recordDiagnostic('upload_intent_expired', { recordingId: rec.id });
        }),
      onTrialCreated: (jobId) => patch(rec.id, { status: 'processing', jobId }).then(() => {
        recordDiagnostic('trial_created', { recordingId: rec.id, jobId });
      }),
    });
    await patch(rec.id, patch_);
    recordDiagnostic('pipeline_state', {
      recordingId: rec.id,
      status: patch_.status ?? rec.status,
      ...(patch_.jobId ? { jobId: patch_.jobId } : {}),
      ...(patch_.failReason ? { reason: patch_.failReason } : {}),
    });
  } finally {
    inFlight.delete(rec.id);
  }
}

// --- Public store operations ---------------------------------------------------

async function add(testId: TestId, videoUri: string): Promise<Recording> {
  const list = await ensureLoaded();
  const id = makeId();
  const durableUri = await persistRecordingFile(videoUri, id);
  const rec: Recording = {
    id,
    testId,
    createdAt: Date.now(),
    videoUri: durableUri,
    status: 'uploading',
    uploadProgress: 0,
    uploadAttempt: 1,
    uploadRetrying: false,
  };
  cache = [rec, ...(cache ?? list)];
  try {
    await persist();
  } catch (error) {
    cache = (cache ?? []).filter((r) => r.id !== id);
    await deleteRecordingFile(durableUri).catch(() => {});
    throw error;
  }
  emit();
  recordDiagnostic('recording_saved', { recordingId: id, testId, uri: 'documents' });
  // Fire-and-forget the persisted upload/analysis pipeline.
  void drive(rec);
  return rec;
}

async function removeById(id: string) {
  const list = await ensureLoaded();
  const recording = list.find((r) => r.id === id);
  if (!recording) return;
  if (inFlight.has(id) && !recording.jobId) {
    // Avoid leaving a partially uploaded object with no trial id to delete.
    // This window covers only the byte upload and tiny trial-creation request.
    throw new Error('recording upload is still being finalized');
  }
  let jobId = recording.jobId;
  if (!jobId && recording.uploadId) {
    const pendingResult = await deleteRemoteUpload(recording.uploadId);
    if (pendingResult === 'consumed') {
      // POST /trials succeeded but its response was lost. Repeating it is
      // idempotent and recovers the trial id needed for complete deletion.
      const recovered = await createAnalysisTrial(
        recording.uploadId,
        recording.testId,
        recording.id,
        recording.createdAt,
      );
      jobId = recovered.jobId;
    }
  }
  if (jobId) await deleteRemoteRecording(jobId);
  await deleteRecordingFile(recording.videoUri);
  cache = (cache ?? list).filter((r) => r.id !== id);
  await persist();
  emit();
  recordDiagnostic('recording_deleted', { recordingId: id, remote: Boolean(jobId || recording.uploadId) });
}

/** Re-drive any recording left un-finished, and auto-resume upload-phase
 *  failures from a prior session. Permanent + analysis failures wait for a
 *  manual Retry tap. */
function resumePending() {
  if (!cache) return;
  for (const r of cache) {
    if (r.status === 'uploading' || r.status === 'processing') void drive(r);
    else if (r.status === 'failed' && r.resumable) void resume(r.id);
  }
}

/** Resume the exact failed phase. In particular, preserve uploadId so a failed
 * trial-creation request never retransmits the already-uploaded video. */
async function resume(id: string) {
  const existing = (await ensureLoaded()).find((r) => r.id === id);
  if (!existing) return;
  await patch(id, {
    status: existing.uploadId ? 'processing' : 'uploading',
    uploadProgress: existing.uploadId ? undefined : 0,
    uploadAttempt: existing.uploadId ? undefined : 1,
    uploadRetrying: false,
    failReason: undefined,
    permanent: undefined,
    resumable: undefined,
  });
  const rec = (cache ?? []).find((r) => r.id === id);
  if (rec) void drive(rec);
}

// --- React hook ----------------------------------------------------------------

export function useRecordings() {
  const [recordings, setRecordings] = useState<Recording[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    let mounted = true;
    const sync = () => {
      if (mounted) setRecordings(cache ? [...cache] : []);
    };
    listeners.add(sync);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') resumePending();
    });
    ensureLoaded().then(() => {
      if (!mounted) return;
      setLoading(false);
      sync();
      resumePending();
    });
    return () => {
      mounted = false;
      listeners.delete(sync);
      appStateSubscription.remove();
    };
  }, []);

  const addRecording = useCallback(add, []);
  const remove = useCallback(removeById, []);
  const retry = useCallback((id: string) => void resume(id), []);

  return { recordings, loading, addRecording, remove, retry };
}

export const __testing = { driveOnce };
