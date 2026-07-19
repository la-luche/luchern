import { useUser } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { ApiError, ensurePatientOnboarded } from './api';
import {
  AnalysisNeedsRetryError,
  UploadIntentExpiredError,
  createAnalysisTrial,
  deleteRemoteRecording,
  deleteRemoteUpload,
  pollResult,
  uploadRecording,
} from './cloud';
import { diagnosticErrorData, recordDiagnostic } from './diagnostics';
import { FaceBlurCancelledError, prepareFaceBlurredVideo } from './faceBlur';
import { getFaceBlurEnabled } from './faceBlurSettings';
import {
  deleteAllRecordingFiles,
  deleteRecordingFile,
  persistRecordingFile,
} from './recordingFiles';
import { fetchOwnedTrials, mergeOwnedTrials } from './recordingSync';
import type { EvaluatedSide, TestId } from './tests';
import type { Recording } from './types';
import {
  OperationCancelledError,
  PollTimeoutError,
  UPLOAD_BACKOFFS_MS,
  cancellableDelay,
  classifyUploadError,
  createSerialQueue,
  throwIfCancelled,
} from './uploadRetry';

const LEGACY_STORAGE_KEY = 'luche.recordings.v1';
const STORAGE_KEY_PREFIX = 'luche.recordings.v2.';

let activeAccountId: string | null = null;
let requestedAccountId: string | null = null;
let accountEpoch = 0;
let suspended = false;
let cache: Recording[] | null = null;
let loadPromise: Promise<Recording[]> | null = null;
let activationPromise: Promise<void> | null = null;
let persistTail: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const operations = new Map<
  string,
  { controller: AbortController; promise: Promise<void>; epoch: number }
>();

// One byte upload at a time. Parallel videos compete on weak uplinks and can
// all overrun their presigned URL lifetimes.
const serialUpload = createSerialQueue();
// Native video exporters are intentionally serialized. Two simultaneous
// detector/encoder jobs are especially punishing on older patient phones.
const serialFaceBlur = createSerialQueue();

function storageKey(accountId: string): string {
  return `${STORAGE_KEY_PREFIX}${accountId}`;
}

function isCurrent(epoch: number, accountId: string | null = activeAccountId): boolean {
  return !suspended && epoch === accountEpoch && accountId === activeAccountId;
}

function emit() {
  for (const listener of listeners) listener();
}

async function persist(expectedEpoch: number = accountEpoch): Promise<void> {
  if (!isCurrent(expectedEpoch) || !activeAccountId) return;
  const key = storageKey(activeAccountId);
  const snapshot = JSON.stringify(cache ?? []);
  const write = persistTail.then(() => AsyncStorage.setItem(key, snapshot));
  persistTail = write.catch(() => {});
  await write;
}

async function ensureLoaded(): Promise<Recording[]> {
  if (!activeAccountId) throw new Error('recording account unavailable');
  if (cache) return cache;
  if (!loadPromise) {
    const accountId = activeAccountId;
    const epoch = accountEpoch;
    loadPromise = (async () => {
      const key = storageKey(accountId);
      let raw = await AsyncStorage.getItem(key);
      if (raw == null) {
        // One-time migration from the pre-account cache. AuthGate meant these
        // records belonged to whichever account was already signed in.
        raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        if (raw != null) {
          await AsyncStorage.setItem(key, raw);
          await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      }
      const loaded = raw ? (JSON.parse(raw) as Recording[]) : [];
      if (epoch === accountEpoch && accountId === activeAccountId) cache = loaded;
      return loaded;
    })();
  }
  return loadPromise;
}

function makeId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

async function patch(
  id: string,
  partial: Partial<Recording>,
  expectedEpoch: number = accountEpoch,
) {
  if (!isCurrent(expectedEpoch)) return;
  const list = await ensureLoaded();
  if (!isCurrent(expectedEpoch)) return;
  cache = list.map((recording) =>
    recording.id === id ? { ...recording, ...partial } : recording,
  );
  await persist(expectedEpoch);
  if (isCurrent(expectedEpoch)) emit();
}

function patchVolatile(id: string, partial: Partial<Recording>, expectedEpoch: number) {
  if (!cache || !isCurrent(expectedEpoch)) return;
  cache = cache.map((recording) =>
    recording.id === id ? { ...recording, ...partial } : recording,
  );
  emit();
}

async function uploadWithRetry(
  rec: Recording,
  maxBackoffs: number = UPLOAD_BACKOFFS_MS.length,
  onProgress?: (fraction: number) => void,
  onAttempt?: (attempt: number) => void,
  onRetry?: (nextAttempt: number, delayMs: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!rec.videoUri) throw new Error('recording file missing');
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxBackoffs; attempt++) {
    throwIfCancelled(signal);
    try {
      onAttempt?.(attempt + 1);
      onProgress?.(0);
      const response = signal
        ? await uploadRecording(rec.videoUri, rec.testId, onProgress, signal)
        : await uploadRecording(rec.videoUri, rec.testId, onProgress);
      return response.uploadId;
    } catch (error) {
      throwIfCancelled(signal);
      lastError = error;
      recordDiagnostic('upload_attempt_failed', {
        recordingId: rec.id,
        attempt: attempt + 1,
        ...diagnosticErrorData(error),
      });
      if (classifyUploadError(error) === 'permanent') throw error;
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        throw error;
      }
      if (attempt < maxBackoffs) {
        const retryDelay = UPLOAD_BACKOFFS_MS[attempt] + Math.floor(Math.random() * 1000);
        onRetry?.(attempt + 2, retryDelay);
        await cancellableDelay(retryDelay, signal);
      }
    }
  }
  throw lastError;
}

async function createTrialWithRetry(
  rec: Recording,
  uploadId: string,
  maxBackoffs: number = UPLOAD_BACKOFFS_MS.length,
  signal?: AbortSignal,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxBackoffs; attempt++) {
    throwIfCancelled(signal);
    try {
      const response = signal
        ? await createAnalysisTrial(
            uploadId,
            rec.testId,
            rec.id,
            rec.createdAt,
            rec.evaluatedSide,
            signal,
          )
        : await createAnalysisTrial(
            uploadId,
            rec.testId,
            rec.id,
            rec.createdAt,
            rec.evaluatedSide,
          );
      return response.jobId;
    } catch (error) {
      throwIfCancelled(signal);
      lastError = error;
      recordDiagnostic('trial_submit_failed', {
        recordingId: rec.id,
        uploadId,
        attempt: attempt + 1,
        ...diagnosticErrorData(error),
      });
      if (error instanceof UploadIntentExpiredError) throw error;
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 422 &&
        error.status !== 429
      ) {
        throw error;
      }
      if (attempt < maxBackoffs) {
        const retryDelay = UPLOAD_BACKOFFS_MS[attempt] + Math.floor(Math.random() * 1000);
        await cancellableDelay(retryDelay, signal);
      }
    }
  }
  throw lastError;
}

/** Pure upload→submit→poll lifecycle. Boundary callbacks make durable writes. */
async function driveOnce(
  rec: Recording,
  opts: {
    maxBackoffs?: number;
    signal?: AbortSignal;
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
      for (let intentAttempt = 0; intentAttempt < 2; intentAttempt++) {
        throwIfCancelled(opts.signal);
        if (!uploadId) {
          phase = 'upload';
          uploadId = await serialUpload(() =>
            uploadWithRetry(
              rec,
              opts.maxBackoffs,
              opts.onUploadProgress,
              opts.onUploadAttempt,
              opts.onUploadRetry,
              opts.signal,
            ),
          );
          await opts.onBytesUploaded?.(uploadId);
        }
        phase = 'submit';
        try {
          jobId = await createTrialWithRetry(rec, uploadId, opts.maxBackoffs, opts.signal);
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
    const result = opts.signal
      ? await pollResult(jobId, rec.testId, opts.signal)
      : await pollResult(jobId, rec.testId);
    return {
      status: 'done',
      uploadId,
      uploadProgress: undefined,
      uploadAttempt: undefined,
      uploadRetrying: undefined,
      jobId,
      result,
    };
  } catch (error) {
    if (error instanceof OperationCancelledError || opts.signal?.aborted) throw error;
    if (error instanceof PollTimeoutError) {
      return {
        status: 'processing',
        uploadId,
        uploadProgress: undefined,
        uploadAttempt: undefined,
        uploadRetrying: undefined,
        jobId,
      };
    }
    if (error instanceof AnalysisNeedsRetryError) {
      return {
        status: 'needs_retry',
        failReason: error.message,
        analysisFailureReasons: error.reasons,
        uploadId,
        uploadProgress: undefined,
        uploadAttempt: undefined,
        uploadRetrying: undefined,
        jobId,
        permanent: undefined,
        resumable: false,
      };
    }
    const permanent = classifyUploadError(error) === 'permanent';
    return {
      status: 'failed',
      failReason: error instanceof Error ? error.message : String(error),
      uploadId,
      uploadProgress: undefined,
      uploadAttempt: undefined,
      uploadRetrying: undefined,
      permanent,
      resumable: phase !== 'poll' && !permanent,
    };
  }
}

async function runDrive(rec: Recording, epoch: number, signal: AbortSignal) {
  try {
    let uploadRecording = rec;
    if (
      rec.faceBlurRequested &&
      rec.faceBlurState !== 'completed' &&
      rec.faceBlurState !== 'bypassed' &&
      !rec.uploadId &&
      !rec.jobId
    ) {
      const sourceVideoUri = rec.faceBlurOriginalUri ?? rec.videoUri;
      if (!sourceVideoUri) {
        await patch(rec.id, {
          status: 'blur_failed',
          faceBlurState: 'failed',
          faceBlurProgress: undefined,
          failReason: 'recording file missing',
          resumable: false,
        }, epoch);
        return;
      }

      await patch(rec.id, {
        status: 'preparing',
        faceBlurState: 'processing',
        faceBlurProgress: 0,
        failReason: undefined,
        resumable: undefined,
        permanent: undefined,
      }, epoch);
      recordDiagnostic('face_blur_started', { recordingId: rec.id });

      try {
        const originalUri = sourceVideoUri;
        const prepared = await serialFaceBlur(() =>
          prepareFaceBlurredVideo(
            rec.id,
            originalUri,
            (faceBlurProgress) => patchVolatile(rec.id, { faceBlurProgress }, epoch),
            signal,
          ),
        );
        throwIfCancelled(signal);
        const preparedRecording: Recording = {
          ...rec,
          videoUri: prepared.videoUri,
          faceBlurOriginalUri: originalUri,
          status: 'preparing',
          faceBlurState: 'processing',
          faceBlurProgress: undefined,
          faceBlurFramesProcessed: prepared.recovered
            ? rec.faceBlurFramesProcessed
            : prepared.framesProcessed,
          faceBlurFramesWithFaces: prepared.recovered
            ? rec.faceBlurFramesWithFaces
            : prepared.framesWithFaces,
          faceBlurDetections: prepared.recovered
            ? rec.faceBlurDetections
            : prepared.detections,
          failReason: undefined,
          resumable: undefined,
          permanent: undefined,
        };
        // Crash-safe privacy commit: persist both paths, delete the original,
        // then clear its reference and permit upload.
        await patch(rec.id, preparedRecording, epoch);
        if (!isCurrent(epoch)) return;
        if (originalUri !== prepared.videoUri) {
          await deleteRecordingFile(originalUri);
        }
        uploadRecording = {
          ...preparedRecording,
          faceBlurOriginalUri: undefined,
          status: 'uploading',
          faceBlurState: 'completed',
          uploadProgress: 0,
          uploadAttempt: 1,
          uploadRetrying: false,
        };
        await patch(rec.id, uploadRecording, epoch);
        if (!isCurrent(epoch)) return;
        recordDiagnostic('face_blur_completed', {
          recordingId: rec.id,
          framesProcessed: prepared.framesProcessed,
          framesWithFaces: prepared.framesWithFaces,
          detections: prepared.detections,
          recovered: prepared.recovered,
        });
      } catch (error) {
        if (error instanceof FaceBlurCancelledError || signal.aborted) throw error;
        await patch(rec.id, {
          status: 'blur_failed',
          faceBlurState: 'failed',
          faceBlurProgress: undefined,
          failReason: error instanceof Error ? error.message : String(error),
          resumable: false,
          permanent: false,
        }, epoch);
        recordDiagnostic('face_blur_failed', {
          recordingId: rec.id,
          ...diagnosticErrorData(error),
        });
        return;
      }
    }

    const finalPatch = await driveOnce(uploadRecording, {
      signal,
      onUploadProgress: (uploadProgress) =>
        patchVolatile(uploadRecording.id, { uploadProgress }, epoch),
      onUploadAttempt: (uploadAttempt) =>
        patchVolatile(
          uploadRecording.id,
          { uploadAttempt, uploadRetrying: false, uploadProgress: 0 },
          epoch,
        ),
      onUploadRetry: (uploadAttempt, delayMs) => {
        patchVolatile(
          uploadRecording.id,
          { uploadAttempt, uploadRetrying: true, uploadProgress: 0 },
          epoch,
        );
        recordDiagnostic('upload_retry_scheduled', {
          recordingId: uploadRecording.id,
          attempt: uploadAttempt,
          delayMs,
        });
      },
      onBytesUploaded: (uploadId) =>
        patch(
          uploadRecording.id,
          {
            status: 'processing',
            uploadId,
            uploadProgress: undefined,
            uploadAttempt: undefined,
            uploadRetrying: undefined,
          },
          epoch,
        ).then(() => {
          recordDiagnostic('upload_completed', { recordingId: uploadRecording.id, uploadId });
        }),
      onUploadExpired: () =>
        patch(
          uploadRecording.id,
          {
            status: 'uploading',
            uploadId: undefined,
            uploadProgress: 0,
            uploadAttempt: undefined,
            uploadRetrying: undefined,
          },
          epoch,
        ).then(() => {
          recordDiagnostic('upload_intent_expired', { recordingId: uploadRecording.id });
        }),
      onTrialCreated: (jobId) =>
        patch(uploadRecording.id, { status: 'processing', jobId }, epoch).then(() => {
          recordDiagnostic('trial_created', { recordingId: uploadRecording.id, jobId });
        }),
    });
    await patch(uploadRecording.id, finalPatch, epoch);
    if (isCurrent(epoch)) {
      recordDiagnostic('pipeline_state', {
        recordingId: rec.id,
        status: finalPatch.status ?? rec.status,
        ...(finalPatch.jobId ? { jobId: finalPatch.jobId } : {}),
        ...(finalPatch.failReason ? { reason: finalPatch.failReason } : {}),
      });
    }
  } catch (error) {
    if (!(error instanceof OperationCancelledError) && !signal.aborted) throw error;
  }
}

function drive(rec: Recording): Promise<void> {
  if (suspended || !activeAccountId) return Promise.resolve();
  const epoch = accountEpoch;
  const operationKey = `${epoch}:${rec.id}`;
  const existing = operations.get(operationKey);
  if (existing) return existing.promise;

  const controller = new AbortController();
  const promise = runDrive(rec, epoch, controller.signal).finally(() => {
    operations.delete(operationKey);
  });
  operations.set(operationKey, { controller, promise, epoch });
  return promise;
}

async function refreshFromServer(expectedEpoch: number = accountEpoch): Promise<void> {
  if (!isCurrent(expectedEpoch)) return;
  const local = await ensureLoaded();
  let response: Awaited<ReturnType<typeof fetchOwnedTrials>>;
  try {
    response = await fetchOwnedTrials();
  } catch (error) {
    // A brand-new Clerk session can render children just before AuthGate's
    // idempotent onboarding request finishes. Complete it and retry once.
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      error.responseBody.includes('not_onboarded')
    ) {
      await ensurePatientOnboarded();
      response = await fetchOwnedTrials();
    } else {
      throw error;
    }
  }
  if (!isCurrent(expectedEpoch)) return;
  const merged = mergeOwnedTrials(local, response.trials);
  cache = merged.recordings;
  await persist(expectedEpoch);
  if (!isCurrent(expectedEpoch)) return;
  emit();
  await Promise.all(
    merged.localUrisToDelete.map((uri) => deleteRecordingFile(uri).catch(() => {})),
  );
}

function cancelOperations() {
  for (const operation of operations.values()) operation.controller.abort();
}

async function activateAccount(accountId: string): Promise<void> {
  if (activeAccountId === accountId && cache) return;
  if (requestedAccountId === accountId && activationPromise) return activationPromise;

  requestedAccountId = accountId;
  const activation = (async () => {
    cancelOperations();
    accountEpoch += 1;
    activeAccountId = accountId;
    suspended = false;
    cache = null;
    loadPromise = null;
    await ensureLoaded();
    emit();
    // Local storage is enough to render the list/empty state. Do not make the
    // screen's loading flag wait on a network request that can be slow or
    // offline; merge cloud history in the background when it arrives.
    resumePending();
    const epoch = accountEpoch;
    void refreshFromServer(epoch)
      .then(() => resumePending())
      .catch((error) => {
        recordDiagnostic('recording_sync_failed', diagnosticErrorData(error));
      });
  })();
  activationPromise = activation;
  try {
    await activation;
  } finally {
    if (activationPromise === activation) activationPromise = null;
  }
}

async function add(
  testId: TestId,
  videoUri: string,
  evaluatedSide?: EvaluatedSide,
): Promise<Recording> {
  const list = await ensureLoaded();
  const epoch = accountEpoch;
  const id = makeId();
  const faceBlurRequested = await getFaceBlurEnabled();
  const durableUri = await persistRecordingFile(videoUri, id);
  const rec: Recording = {
    id,
    testId,
    evaluatedSide,
    createdAt: Date.now(),
    videoUri: durableUri,
    status: faceBlurRequested ? 'preparing' : 'uploading',
    faceBlurRequested,
    faceBlurState: faceBlurRequested ? 'pending' : undefined,
    faceBlurProgress: faceBlurRequested ? 0 : undefined,
    uploadProgress: faceBlurRequested ? undefined : 0,
    uploadAttempt: faceBlurRequested ? undefined : 1,
    uploadRetrying: faceBlurRequested ? undefined : false,
  };
  if (!isCurrent(epoch)) {
    await deleteRecordingFile(durableUri).catch(() => {});
    throw new Error('recording account changed');
  }
  cache = [rec, ...(cache ?? list)];
  try {
    await persist(epoch);
  } catch (error) {
    cache = (cache ?? []).filter((recording) => recording.id !== id);
    await deleteRecordingFile(durableUri).catch(() => {});
    throw error;
  }
  emit();
  recordDiagnostic('recording_saved', {
    recordingId: id,
    testId,
    uri: 'documents',
    faceBlurRequested,
  });
  void drive(rec);
  return rec;
}

function operationForRecording(id: string) {
  return operations.get(`${accountEpoch}:${id}`);
}

async function removeById(id: string) {
  const list = await ensureLoaded();
  const recording = list.find((item) => item.id === id);
  if (!recording) return;
  if (operationForRecording(id) && !recording.jobId) {
    throw new Error('recording upload is still being finalized');
  }
  let jobId = recording.jobId;
  if (!jobId && recording.uploadId) {
    const pendingResult = await deleteRemoteUpload(recording.uploadId);
    if (pendingResult === 'consumed') {
      const recovered = await createAnalysisTrial(
        recording.uploadId,
        recording.testId,
        recording.id,
        recording.createdAt,
        recording.evaluatedSide,
      );
      jobId = recovered.jobId;
    }
  }
  if (jobId) await deleteRemoteRecording(jobId);
  if (recording.videoUri) await deleteRecordingFile(recording.videoUri);
  if (
    recording.faceBlurOriginalUri &&
    recording.faceBlurOriginalUri !== recording.videoUri
  ) {
    await deleteRecordingFile(recording.faceBlurOriginalUri);
  }
  cache = (cache ?? list).filter((item) => item.id !== id);
  await persist();
  emit();
  recordDiagnostic('recording_deleted', {
    recordingId: id,
    remote: Boolean(jobId || recording.uploadId),
  });
}

function resumePending() {
  if (!cache || suspended) return;
  for (const recording of cache) {
    if (
      recording.status === 'preparing' ||
      recording.status === 'uploading' ||
      recording.status === 'processing'
    ) {
      void drive(recording);
    } else if (recording.status === 'failed' && recording.resumable) {
      void resume(recording.id);
    }
  }
}

async function resume(id: string) {
  const existing = (await ensureLoaded()).find((recording) => recording.id === id);
  if (!existing) return;
  if (
    existing.faceBlurRequested &&
    existing.faceBlurState !== 'completed' &&
    existing.faceBlurState !== 'bypassed'
  ) {
    await retryFaceBlur(id);
    return;
  }
  await patch(id, {
    status: existing.uploadId ? 'processing' : 'uploading',
    uploadProgress: existing.uploadId ? undefined : 0,
    uploadAttempt: existing.uploadId ? undefined : 1,
    uploadRetrying: false,
    failReason: undefined,
    analysisFailureReasons: undefined,
    permanent: undefined,
    resumable: undefined,
  });
  const recording = (cache ?? []).find((item) => item.id === id);
  if (recording) void drive(recording);
}

async function retryFaceBlur(id: string) {
  const existing = (await ensureLoaded()).find((recording) => recording.id === id);
  if (!existing?.videoUri || existing.uploadId || existing.jobId) return;
  await patch(id, {
    status: 'preparing',
    faceBlurRequested: true,
    faceBlurState: 'pending',
    faceBlurProgress: 0,
    failReason: undefined,
    permanent: undefined,
    resumable: undefined,
  });
  const recording = (cache ?? []).find((item) => item.id === id);
  if (recording) void drive(recording);
}

async function sendWithoutFaceBlur(id: string) {
  const existing = (await ensureLoaded()).find((recording) => recording.id === id);
  if (!existing?.videoUri || existing.uploadId || existing.jobId) return;
  const unblurredUri = existing.faceBlurOriginalUri ?? existing.videoUri;
  const sanitizedUri = existing.videoUri !== unblurredUri ? existing.videoUri : undefined;
  await patch(id, {
    videoUri: unblurredUri,
    faceBlurOriginalUri: undefined,
    status: 'uploading',
    faceBlurRequested: false,
    faceBlurState: 'bypassed',
    faceBlurProgress: undefined,
    uploadProgress: 0,
    uploadAttempt: 1,
    uploadRetrying: false,
    failReason: undefined,
    permanent: undefined,
    resumable: undefined,
  });
  if (sanitizedUri) await deleteRecordingFile(sanitizedUri).catch(() => {});
  recordDiagnostic('face_blur_bypassed', { recordingId: id });
  const recording = (cache ?? []).find((item) => item.id === id);
  if (recording) void drive(recording);
}

/** Cancel all local work, delete every app-owned clip, and clear this account's cache. */
async function purgeForLogout(): Promise<void> {
  const accountId = activeAccountId;
  if (!accountId) return;
  suspended = true;
  accountEpoch += 1;
  cancelOperations();
  await Promise.allSettled([...operations.values()].map((operation) => operation.promise));
  await persistTail.catch(() => {});
  await deleteAllRecordingFiles();
  const recordingKeys = (await AsyncStorage.getAllKeys()).filter(
    (key) => key === LEGACY_STORAGE_KEY || key.startsWith(STORAGE_KEY_PREFIX),
  );
  if (recordingKeys.length > 0) await AsyncStorage.multiRemove(recordingKeys);
  cache = [];
  loadPromise = null;
  activeAccountId = null;
  requestedAccountId = null;
  emit();
}

export function useRecordings() {
  const { user } = useUser();
  const accountId = user?.id ?? null;
  const [recordings, setRecordings] = useState<Recording[]>(cache ?? []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const sync = () => {
      if (mounted) setRecordings(cache ? [...cache] : []);
    };
    listeners.add(sync);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !accountId) return;
      void refreshFromServer().catch((error) => {
        recordDiagnostic('recording_sync_failed', diagnosticErrorData(error));
      });
      resumePending();
    });

    if (accountId) {
      setLoading(true);
      void activateAccount(accountId).finally(() => {
        if (!mounted) return;
        sync();
        setLoading(false);
      });
    } else {
      setRecordings([]);
      setLoading(false);
    }
    return () => {
      mounted = false;
      listeners.delete(sync);
      appStateSubscription.remove();
    };
  }, [accountId]);

  const addRecording = useCallback(add, []);
  const remove = useCallback(removeById, []);
  const retry = useCallback((id: string) => void resume(id), []);
  const retryFaceBlurring = useCallback((id: string) => void retryFaceBlur(id), []);
  const uploadWithoutFaceBlurring = useCallback((id: string) => void sendWithoutFaceBlur(id), []);
  const refresh = useCallback(() => refreshFromServer(), []);
  const logoutAndPurge = useCallback(() => purgeForLogout(), []);
  const unuploadedCount = useMemo(
    () => recordings.filter((recording) => recording.videoUri && !recording.jobId).length,
    [recordings],
  );

  return {
    recordings,
    loading,
    addRecording,
    remove,
    retry,
    retryFaceBlurring,
    uploadWithoutFaceBlurring,
    refresh,
    logoutAndPurge,
    unuploadedCount,
  };
}

export const __testing = { driveOnce };
