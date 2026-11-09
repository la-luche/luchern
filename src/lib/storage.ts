import { useUser } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getNetworkStateAsync, useNetworkState } from 'expo-network';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import {
  allowBackgroundWork, endBackgroundWork, ensureBackgroundWork,
  isBackgroundWorkPaused, onBackgroundExpiration, onBackgroundTick, updateBackgroundWork,
} from './backgroundRuntime';
import { armResultNotification, dismissResultNotifications, notifyReadyResults, requestResultNotifications } from './resultNotifications';
import { clearWorkTimeout, setWorkTimeout } from './workTimers';

import { ApiError, ensurePatientOnboarded } from './api';
import { isCaptureActive, subscribeCaptureActivity } from './captureActivity';
import { supersedeCheckupRetakes } from './checkupRetakes';
import {
  clearAllCaptureIntentsAndFiles,
  clearCaptureIntent,
  clearGuestCaptureIntent,
  recoverCaptureIntent,
} from './captureRecovery';
import {
  AnalysisNeedsRetryError,
  UploadIntentExpiredError,
  createAnalysisTrial,
  deleteRemoteRecording,
  deleteRemoteUpload,
  pollResult,
  pollResultOnce,
  uploadRecording,
} from './cloud';
import { diagnosticErrorData, recordDiagnostic } from './diagnostics';
import { deletedGuestIds, loadDeletedGuests, subscribeGuestDeletion } from './guestDeletionState';
import { clearSelfProfiles } from './selfProfile';
import { FaceBlurCancelledError, prepareFaceBlurredVideo } from './faceBlur';
import { getPrivacyBlurSettings } from './faceBlurSettings';
import {
  activateGuestAccount,
  clearAllGuestCaches,
  ensureGuestSyncedForAccount,
} from './guestStorage';
import {
  deleteAllRecordingFiles,
  clearRecordingExportTemps,
  deleteRecordingFile,
  deleteRecordingManifest,
  deletePrivacyBlurArtifacts,
  excludeRecordingsFromBackup,
  persistRecordingFile,
  persistRecordingManifest,
  readRecordingManifests,
  recordingFileUri,
  recordingFileSize,
  rebindRecordingFileUri,
  recordingFileExists,
} from './recordingFiles';
import { fetchOwnedTrials, mergeTrialScope } from './recordingSync';
import type { EvaluatedSide, TestId } from './tests';
import type { EvaluationRunRef, Recording } from './types';
import {
  OperationCancelledError,
  PollTimeoutError,
  UPLOAD_BACKOFFS_MS,
  cancellableDelay,
  classifyUploadError,
  createConcurrencyQueue,
  createSerialQueue,
  selectPipelineBatch,
  throwIfCancelled,
} from './uploadRetry';

const LEGACY_STORAGE_KEY = 'luche.recordings.v1';
const STORAGE_KEY_PREFIX = 'luche.recordings.v2.';
const CHUNK_STORAGE_KEY_PREFIX = 'luche.recordings.v3.';
const RECORDINGS_PER_CHUNK = 50;

type RecordingSnapshotManifest = {
  version: 3;
  generation: number;
  count: number;
  chunks: number;
};

let activeAccountId: string | null = null;
let requestedAccountId: string | null = null;
let accountEpoch = 0;
let suspended = false;
let cache: Recording[] | null = null;
let loadPromise: Promise<Recording[]> | null = null;
let activationPromise: Promise<void> | null = null;
let persistTail: Promise<void> = Promise.resolve();
let cacheMutationTail: Promise<void> = Promise.resolve();
const pendingSnapshots = new Map<string, Recording[]>();
const snapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();
const snapshotGenerations = new Map<string, number>();
const listeners = new Set<() => void>();
const operations = new Map<
  string,
  {
    controller: AbortController;
    promise: Promise<void>;
    epoch: number;
    stage: 'ingest' | 'poll';
  }
>();
const MAX_ACTIVE_INGEST = 2;
const MAX_ACTIVE_POLLS = 4;
let pollWakeTimer: ReturnType<typeof setTimeout> | null = null;
let resumePromise: Promise<void> | null = null;
const refreshRequests = new Map<string, Promise<void>>();
const pipelineCooldowns = new Map<string, number>();
const pausedGuests = new Map<string, number>();
const guestPurges = new Map<string, Promise<void>>();
const guestStages = new Map<string, Set<Promise<Recording>>>();
const guestWorkKey = (accountId: string, guestId: string) => `${accountId}:${guestId}`;
function guestWorkBlocked(accountId: string, guestId?: string) {
  return !!guestId && (deletedGuestIds(accountId).has(guestId) || pausedGuests.has(guestWorkKey(accountId, guestId)));
}

// One byte upload at a time. Parallel videos compete on weak uplinks and can
// all overrun their presigned URL lifetimes.
const serialUpload = createSerialQueue();
// Hundreds of offline captures may reconnect together. Limit their long-lived
// result poll loops so the Pi API sees bounded traffic while server jobs keep
// processing independently.
const limitedResultPolling = createConcurrencyQueue(4);
// Native video exporters are intentionally serialized. Two simultaneous
// detector/encoder jobs are especially punishing on older patient phones.
const serialPrivacyBlur = createSerialQueue();
let networkStateRequest: ReturnType<typeof getNetworkStateAsync> | null = null;

function currentNetworkState(): ReturnType<typeof getNetworkStateAsync> {
  if (networkStateRequest) return networkStateRequest;
  const request = getNetworkStateAsync();
  networkStateRequest = request;
  void request.finally(() => {
    if (networkStateRequest === request) networkStateRequest = null;
  }).catch(() => {});
  return request;
}

function storageKey(accountId: string): string {
  return `${STORAGE_KEY_PREFIX}${accountId}`;
}

function chunkStoragePrefix(accountId: string): string {
  return `${CHUNK_STORAGE_KEY_PREFIX}${encodeURIComponent(accountId)}.`;
}

function snapshotManifestKey(accountId: string, slot: number): string {
  return `${chunkStoragePrefix(accountId)}manifest.${slot}`;
}

function snapshotChunkKey(accountId: string, generation: number, index: number): string {
  return `${chunkStoragePrefix(accountId)}chunk.${generation}.${index}`;
}

async function readRecordingSnapshot(accountId: string): Promise<Recording[] | null> {
  const manifests = await AsyncStorage.multiGet([
    snapshotManifestKey(accountId, 0),
    snapshotManifestKey(accountId, 1),
  ]);
  const candidates = manifests
    .flatMap(([, raw]) => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as RecordingSnapshotManifest;
        return parsed.version === 3 &&
          Number.isInteger(parsed.generation) && parsed.generation >= 0 &&
          Number.isInteger(parsed.count) && parsed.count >= 0 &&
          Number.isInteger(parsed.chunks) && parsed.chunks >= 0
          ? [parsed]
          : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.generation - a.generation);
  for (const manifest of candidates) {
    try {
      const values = manifest.chunks === 0
        ? []
        : await AsyncStorage.multiGet(
            Array.from({ length: manifest.chunks }, (_, index) =>
              snapshotChunkKey(accountId, manifest.generation, index),
            ),
          );
      if (values.some(([, raw]) => raw == null)) continue;
      const recordings = values.flatMap(([, raw]) => {
        const parsed = JSON.parse(raw!) as unknown;
        if (!Array.isArray(parsed)) throw new Error('invalid recording chunk');
        return parsed as Recording[];
      });
      if (recordings.length !== manifest.count) continue;
      snapshotGenerations.set(accountId, manifest.generation);
      return recordings;
    } catch {
      // Try the previous A/B generation.
    }
  }
  return null;
}

async function writeRecordingSnapshot(accountId: string, recordings: Recording[]): Promise<void> {
  const generation = (snapshotGenerations.get(accountId) ?? 0) + 1;
  const chunks = Array.from(
    { length: Math.ceil(recordings.length / RECORDINGS_PER_CHUNK) },
    (_, index) => recordings.slice(
      index * RECORDINGS_PER_CHUNK,
      (index + 1) * RECORDINGS_PER_CHUNK,
    ),
  );
  if (chunks.length > 0) {
    await AsyncStorage.multiSet(
      chunks.map((chunk, index) => [
        snapshotChunkKey(accountId, generation, index),
        JSON.stringify(chunk),
      ]),
    );
  }
  const slot = generation % 2;
  await AsyncStorage.setItem(
    snapshotManifestKey(accountId, slot),
    JSON.stringify({
      version: 3,
      generation,
      count: recordings.length,
      chunks: chunks.length,
    } satisfies RecordingSnapshotManifest),
  );
  snapshotGenerations.set(accountId, generation);
  try {
    await AsyncStorage.removeItem(storageKey(accountId));
    const otherRaw = await AsyncStorage.getItem(snapshotManifestKey(accountId, 1 - slot));
    let previousGeneration: number | null = null;
    try {
      const other = otherRaw ? (JSON.parse(otherRaw) as RecordingSnapshotManifest) : null;
      if (other?.version === 3 && Number.isInteger(other.generation)) {
        previousGeneration = other.generation;
      }
    } catch {
      previousGeneration = null;
    }
    const prefix = `${chunkStoragePrefix(accountId)}chunk.`;
    const obsolete = (await AsyncStorage.getAllKeys()).filter((key) => {
      if (!key.startsWith(prefix)) return false;
      const generationPart = Number(key.slice(prefix.length).split('.', 1)[0]);
      return generationPart !== generation && generationPart !== previousGeneration;
    });
    if (obsolete.length > 0) await AsyncStorage.multiRemove(obsolete);
  } catch (error) {
    recordDiagnostic('recording_snapshot_cleanup_failed', diagnosticErrorData(error));
  }
}

function isCurrent(epoch: number, accountId: string | null = activeAccountId): boolean {
  return !suspended && epoch === accountEpoch && accountId === activeAccountId;
}

function emit() {
  for (const listener of listeners) listener();
}

/** Serialize read-modify-write transitions across every recording. Without
 * this, two uploads completing together can each map an old cache snapshot and
 * one can erase the other's newly persisted uploadId/jobId. */
function withCacheMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = cacheMutationTail.catch(() => undefined).then(task);
  cacheMutationTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function persist(expectedEpoch: number = accountEpoch): Promise<void> {
  if (!isCurrent(expectedEpoch) || !activeAccountId) return;
  const accountId = activeAccountId;
  const timer = snapshotTimers.get(accountId);
  if (timer) clearTimeout(timer);
  snapshotTimers.delete(accountId);
  pendingSnapshots.delete(accountId);
  const snapshot = [...(cache ?? [])];
  const write = persistTail.then(() => writeRecordingSnapshot(accountId, snapshot));
  persistTail = write.catch(() => {});
  await write;
}

/**
 * Per-record manifests are the crash-safe source of truth, so hot transitions
 * (upload progress boundaries and bulk retry) can coalesce the aggregate index
 * into one write. Relaunch reconstructs any record that missed this snapshot
 * from its independent manifest.
 */
function schedulePersist(expectedEpoch: number = accountEpoch): void {
  if (!isCurrent(expectedEpoch) || !activeAccountId) return;
  const accountId = activeAccountId;
  pendingSnapshots.set(accountId, [...(cache ?? [])]);
  if (snapshotTimers.has(accountId)) return;
  const timer = setTimeout(() => {
    snapshotTimers.delete(accountId);
    const snapshot = pendingSnapshots.get(accountId);
    pendingSnapshots.delete(accountId);
    if (!snapshot) return;
    const write = persistTail.then(() => writeRecordingSnapshot(accountId, snapshot));
    persistTail = write.catch(() => {});
    void write.catch((error) => {
      recordDiagnostic('recording_index_write_failed', diagnosticErrorData(error));
    });
  }, 500);
  snapshotTimers.set(accountId, timer);
}

async function ensureLoaded(): Promise<Recording[]> {
  if (!activeAccountId) throw new Error('recording account unavailable');
  if (cache) return cache;
  if (!loadPromise) {
    const accountId = activeAccountId;
    const epoch = accountEpoch;
    loadPromise = (async () => {
      const key = storageKey(accountId);
      const chunked = await readRecordingSnapshot(accountId);
      let raw: string | null = null;
      if (chunked == null) {
        try {
          raw = await AsyncStorage.getItem(key);
        } catch (error) {
          // Android's legacy SQLite backend can reject an oversized single
          // row. Continue into per-video manifest recovery instead of making
          // the whole recording store unavailable.
          recordDiagnostic('recording_index_read_failed', diagnosticErrorData(error));
        }
      }
      if (raw == null) {
        // One-time migration from the pre-account cache. AuthGate meant these
        // records belonged to whichever account was already signed in.
        raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        if (raw != null) {
          await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      }
      let parsed: Recording[] = chunked ?? [];
      if (chunked == null && raw) {
        try {
          const value = JSON.parse(raw) as unknown;
          if (Array.isArray(value)) parsed = value as Recording[];
        } catch (error) {
          // Keep going: per-video manifests are deliberately independent of
          // this aggregate cache and can rebuild the local index.
          recordDiagnostic('recording_index_corrupt', diagnosticErrorData(error));
        }
      }
      const manifests = await readRecordingManifests(accountId);
      const newestById = new Map<string, Recording>();
      for (const recording of [...parsed, ...manifests]) {
        const current = newestById.get(recording.id);
        if (!current || (recording.localRevision ?? 0) > (current.localRevision ?? 0)) {
          newestById.set(recording.id, recording);
        }
      }
      const indexed = [...newestById.values()].sort((a, b) => b.createdAt - a.createdAt);
      let rebound = false;
      const loaded = await Promise.all(
        indexed.map(async (recording) => {
          let videoUri = await rebindRecordingFileUri(recording.videoUri);
          let originalVideoUri = await rebindRecordingFileUri(recording.originalVideoUri);
          const privacyBlurOriginalUri = await rebindRecordingFileUri(
            recording.privacyBlurOriginalUri,
          );
          if (videoUri && recording.jobId && !(await recordingFileExists(videoUri))) {
            videoUri = undefined;
          }
          if (originalVideoUri && !(await recordingFileExists(originalVideoUri))) {
            originalVideoUri = undefined;
          }
          // Migrate a completed legacy privacy commit only when its original
          // still exists. Missing legacy paths must never create a broken
          // Original toggle.
          if (
            !originalVideoUri &&
            recording.privacyBlurState === 'completed' &&
            await recordingFileExists(privacyBlurOriginalUri)
          ) {
            originalVideoUri = privacyBlurOriginalUri;
          }
          // Old releases stored only videoUri, even after upload. Treat any
          // still-local unclassified file as a potential original forever;
          // automatic sanitized retention must never delete ambiguous bytes.
          if (!originalVideoUri && videoUri && recording.privacyBlurState !== 'completed') {
            originalVideoUri = videoUri;
          }
          const mustMigrateToPrivacy =
            !recording.uploadId &&
            !recording.jobId &&
            recording.status !== 'draft' &&
            recording.privacyBlurState == null;
          const migrated: Recording = mustMigrateToPrivacy
            ? {
                ...recording,
                videoUri,
                originalVideoUri: originalVideoUri ?? videoUri,
                privacyBlurOriginalUri,
                status: 'preparing',
                faceBlurRequested: true,
                backgroundBlurRequested: true,
                privacyBlurState: 'pending',
                uploadProgress: undefined,
                uploadAttempt: undefined,
                uploadRetrying: undefined,
                localRevision: (recording.localRevision ?? 0) + 1,
              }
            : { ...recording, videoUri, originalVideoUri, privacyBlurOriginalUri };
          if (
            !mustMigrateToPrivacy &&
            videoUri === recording.videoUri &&
            originalVideoUri === recording.originalVideoUri &&
            privacyBlurOriginalUri === recording.privacyBlurOriginalUri
          ) {
            return recording;
          }
          rebound = true;
          return migrated;
        }),
      );
      const reconciled = supersedeCheckupRetakes(loaded);
      for (let index = 0; index < reconciled.length; index++) {
        if (reconciled[index] !== loaded[index]) {
          rebound = true;
          await persistRecordingManifest(accountId, reconciled[index]);
        }
      }
      if (
        chunked == null ||
        rebound ||
        manifests.some((recording) => !parsed.includes(recording))
      ) {
        await writeRecordingSnapshot(accountId, reconciled);
      }
      if (epoch === accountEpoch && accountId === activeAccountId) cache = reconciled;
      return reconciled;
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
  await withCacheMutation(async () => {
    if (!isCurrent(expectedEpoch)) return;
    const list = await ensureLoaded();
    if (!isCurrent(expectedEpoch)) return;
    cache = list.map((recording) =>
      recording.id === id
        ? {
            ...recording,
            ...partial,
            // A running privacy/upload task may still hold a pre-retake snapshot.
            ...(recording.supersededEvaluationRun ? {
              evaluationRun: undefined,
              supersededEvaluationRun: recording.supersededEvaluationRun,
            } : {}),
            localRevision: (recording.localRevision ?? 0) + 1,
          }
        : recording,
    );
    const updated = cache.find((recording) => recording.id === id);
    if (updated?.videoUri && activeAccountId) {
      await persistRecordingManifest(activeAccountId, updated);
    }
    schedulePersist(expectedEpoch);
    if (isCurrent(expectedEpoch)) emit();
  });
}

function patchVolatile(id: string, partial: Partial<Recording>, expectedEpoch: number) {
  if (!cache || !isCurrent(expectedEpoch)) return;
  cache = cache.map((recording) =>
    recording.id === id ? { ...recording, ...partial } : recording,
  );
  emit();
}

function recordingRequestsPrivacy(rec: Recording): boolean {
  return Boolean(
    rec.faceBlurRequested ||
    rec.backgroundBlurRequested ||
    rec.privacyBlurState != null,
  );
}

async function uploadWithRetry(
  rec: Recording,
  maxBackoffs: number = UPLOAD_BACKOFFS_MS.length,
  onProgress?: (fraction: number) => void,
  onAttempt?: (attempt: number) => void,
  onRetry?: (nextAttempt: number, delayMs: number) => void,
  signal?: AbortSignal,
  expectedAccountId?: string,
): Promise<string> {
  if (!rec.videoUri) throw new Error('recording file missing');
  const privacyRequested = recordingRequestsPrivacy(rec);
  if (privacyRequested && rec.privacyBlurState !== 'completed') {
    throw new Error('de-identified recording is not ready');
  }
  if (privacyRequested && !rec.videoUri.includes('.privacy-blurred.mp4')) {
    throw new Error('upload source is not a verified de-identified artifact');
  }
  const artifactKind = privacyRequested ? 'deidentified' as const : 'original' as const;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxBackoffs; attempt++) {
    throwIfCancelled(signal);
    try {
      onAttempt?.(attempt + 1);
      onProgress?.(0);
      const response = await serialUpload(() =>
        signal
          ? uploadRecording(rec.videoUri!, rec.testId, onProgress, signal, expectedAccountId, artifactKind, ...(rec.guestId ? [{ id: rec.guestId, clientTrialId: rec.id }] : []))
          : uploadRecording(rec.videoUri!, rec.testId, onProgress, undefined, expectedAccountId, artifactKind, ...(rec.guestId ? [{ id: rec.guestId, clientTrialId: rec.id }] : [])),
      );
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
  expectedAccountId?: string,
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
            rec.guestId,
            rec.evaluationRun ?? rec.supersededEvaluationRun,
            signal,
            expectedAccountId,
          )
        : await createAnalysisTrial(
            uploadId,
            rec.testId,
            rec.id,
            rec.createdAt,
            rec.evaluatedSide,
            rec.guestId,
            rec.evaluationRun ?? rec.supersededEvaluationRun,
            undefined,
            expectedAccountId,
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
    /** Production scheduler performs one fair request; tests may use legacy polling. */
    singlePoll?: boolean;
    /** Return after trial creation so upload slots are never held by polling. */
    deferPolling?: boolean;
    /** Clerk account that owns this durable operation. */
    expectedAccountId?: string;
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
          uploadId = await uploadWithRetry(
            rec,
            opts.maxBackoffs,
            opts.onUploadProgress,
            opts.onUploadAttempt,
            opts.onUploadRetry,
            opts.signal,
            opts.expectedAccountId,
          );
          await opts.onBytesUploaded?.(uploadId);
        }
        phase = 'submit';
        try {
          jobId = await createTrialWithRetry(
            rec,
            uploadId,
            opts.maxBackoffs,
            opts.signal,
            opts.expectedAccountId,
          );
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
      if (opts.deferPolling) {
        return {
          status: 'processing',
          uploadId,
          uploadProgress: undefined,
          uploadAttempt: undefined,
          uploadRetrying: undefined,
          jobId,
          nextPollAt: 0,
        };
      }
    }
    phase = 'poll';
    const result = await limitedResultPolling(() => {
      if (opts.singlePoll) {
        return opts.signal
          ? pollResultOnce(jobId!, rec.testId, opts.signal, opts.expectedAccountId)
          : pollResultOnce(jobId!, rec.testId, undefined, opts.expectedAccountId);
      }
      return opts.signal
        ? pollResult(jobId!, rec.testId, opts.signal, opts.expectedAccountId)
        : pollResult(jobId!, rec.testId, undefined, opts.expectedAccountId);
    });
    if (result == null) {
      return {
        status: 'processing',
        uploadId,
        uploadProgress: undefined,
        uploadAttempt: undefined,
        uploadRetrying: undefined,
        jobId,
        nextPollAt: Date.now() + 5_000 + Math.floor(Math.random() * 2_000),
      };
    }
    return {
      status: 'done',
      uploadId,
      uploadProgress: undefined,
      uploadAttempt: undefined,
      uploadRetrying: undefined,
      jobId,
      nextPollAt: undefined,
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
    if (
      opts.singlePoll &&
      phase === 'poll' &&
      !(error instanceof Error && error.message === 'analysis failed') &&
      !(
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      )
    ) {
      return {
        status: 'processing',
        uploadId,
        uploadProgress: undefined,
        uploadAttempt: undefined,
        uploadRetrying: undefined,
        jobId,
        nextPollAt: Date.now() + 10_000 + Math.floor(Math.random() * 5_000),
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

async function runDrive(
  rec: Recording,
  epoch: number,
  accountId: string,
  signal: AbortSignal,
) {
  try {
    await ensureBackgroundWork();
    throwIfCancelled(signal);
    let uploadRecording = rec;
    const privacyRequested = recordingRequestsPrivacy(uploadRecording);
    if (
      uploadRecording.uploadId &&
      !uploadRecording.jobId &&
      privacyRequested &&
      uploadRecording.privacyBlurState !== 'completed'
    ) {
      // A prior app release could mint/upload a raw artifact before privacy
      // processing. Never consume that intent. Delete it (or recover and
      // delete the already-created trial), then regenerate from the retained
      // local original under the mandatory privacy pipeline.
      const legacyUploadId = uploadRecording.uploadId;
      const pendingState = await deleteRemoteUpload(legacyUploadId, accountId);
      if (pendingState === 'consumed') {
        const recovered = await createAnalysisTrial(
          legacyUploadId,
          uploadRecording.testId,
          uploadRecording.id,
          uploadRecording.createdAt,
          uploadRecording.evaluatedSide,
          uploadRecording.guestId,
          uploadRecording.evaluationRun ?? uploadRecording.supersededEvaluationRun,
          signal,
          accountId,
        );
        await deleteRemoteRecording(recovered.jobId, accountId);
      }
      uploadRecording = {
        ...uploadRecording,
        uploadId: undefined,
        jobId: undefined,
        status: 'preparing',
        privacyBlurState: 'pending',
        videoUri: uploadRecording.originalVideoUri ?? uploadRecording.videoUri,
      };
      await patch(uploadRecording.id, uploadRecording, epoch);
    }
    if (
      rec.privacyBlurState === 'completed' &&
      !rec.uploadId &&
      !rec.jobId &&
      !(await recordingFileExists(rec.videoUri)) &&
      await recordingFileExists(rec.originalVideoUri)
    ) {
      uploadRecording = {
        ...rec,
        videoUri: rec.originalVideoUri,
        status: 'preparing',
        privacyBlurState: 'pending',
      };
      await patch(rec.id, uploadRecording, epoch);
    }
    if (
      privacyRequested &&
      uploadRecording.privacyBlurState !== 'completed' &&
      !uploadRecording.uploadId &&
      !uploadRecording.jobId
    ) {
      // If the app died after persisting the sanitized output and deleting the
      // original—but before clearing privacyBlurOriginalUri—prefer the still
      // existing sanitized file. Never turn a crash-safe output into a false
      // "recording missing" failure.
      const retainedOriginal =
        uploadRecording.originalVideoUri ?? uploadRecording.privacyBlurOriginalUri;
      const originalStillExists = await recordingFileExists(retainedOriginal);
      const sourceVideoUri = originalStillExists ? retainedOriginal : uploadRecording.videoUri;
      if (!sourceVideoUri) {
        await patch(rec.id, {
          status: 'blur_failed',
          privacyBlurState: 'failed',
          privacyBlurProgress: undefined,
          failReason: 'recording file missing',
          resumable: false,
        }, epoch);
        return;
      }

      await patch(rec.id, {
        status: 'preparing',
        privacyBlurState: 'processing',
        privacyBlurProgress: 0,
        failReason: undefined,
        resumable: undefined,
        permanent: undefined,
      }, epoch);
      const queuedAt = performance.now();
      let startedAt: number | undefined;
      try {
        const originalUri = sourceVideoUri;
        const prepared = await serialPrivacyBlur(() => {
          throwIfCancelled(signal);
          startedAt = performance.now();
          recordDiagnostic('privacy_blur_started', {
            recordingId: rec.id,
            faces: true,
            background: true,
            queueWaitMs: Math.round(startedAt - queuedAt),
          });
          return prepareFaceBlurredVideo(
            rec.id,
            originalUri,
            {
              blurFaces: true,
              blurBackground: true,
            },
            (privacyBlurProgress) => patchVolatile(rec.id, { privacyBlurProgress }, epoch),
            signal,
          );
        });
        const preparedAt = performance.now();
        throwIfCancelled(signal);
        const preparedRecording: Recording = {
          ...uploadRecording,
          videoUri: prepared.videoUri,
          originalVideoUri:
            originalUri !== prepared.videoUri
              ? originalUri
              : uploadRecording.originalVideoUri,
          privacyBlurOriginalUri: undefined,
          status: 'uploading',
          privacyBlurState: 'completed',
          privacyBlurProgress: undefined,
          privacyBlurFramesProcessed: prepared.recovered
            ? uploadRecording.privacyBlurFramesProcessed
            : prepared.framesProcessed,
          privacyBlurFramesWithFaces: prepared.recovered
            ? uploadRecording.privacyBlurFramesWithFaces
            : prepared.framesWithFaces,
          privacyBlurFramesWithBackground: prepared.recovered
            ? uploadRecording.privacyBlurFramesWithBackground
            : prepared.framesWithBackgroundBlur,
          privacyBlurPoseSamples: prepared.recovered
            ? uploadRecording.privacyBlurPoseSamples
            : prepared.poseSamples,
          failReason: undefined,
          uploadProgress: 0,
          uploadAttempt: 1,
          uploadRetrying: false,
          resumable: undefined,
          permanent: undefined,
        };
        // One crash-safe metadata commit switches upload/playback to the
        // sanitized output while retaining the original as local-only data.
        // The original is never uploaded and is not deleted here.
        await patch(rec.id, preparedRecording, epoch);
        if (!isCurrent(epoch)) return;
        uploadRecording = preparedRecording;
        recordDiagnostic('privacy_blur_completed', {
          recordingId: rec.id,
          framesProcessed: prepared.framesProcessed,
          framesWithFaces: prepared.framesWithFaces,
          framesWithBackgroundBlur: prepared.framesWithBackgroundBlur,
          poseSamples: prepared.poseSamples,
          totalPoseSamples: prepared.totalPoseSamples,
          faceSamples: prepared.faceSamples,
          detectorMode: prepared.detectorMode,
          recovered: prepared.recovered,
          queueWaitMs: Math.round((startedAt ?? queuedAt) - queuedAt),
          preparationMs: Math.round(preparedAt - (startedAt ?? queuedAt)),
          ...prepared.timings,
        });
      } catch (error) {
        if (error instanceof FaceBlurCancelledError || signal.aborted) throw error;
        await patch(rec.id, {
          status: 'blur_failed',
          privacyBlurState: 'failed',
          privacyBlurProgress: undefined,
          failReason: error instanceof Error ? error.message : String(error),
          resumable: false,
          permanent: false,
        }, epoch);
        recordDiagnostic('privacy_blur_failed', {
          recordingId: rec.id,
          queueWaitMs: Math.round((startedAt ?? performance.now()) - queuedAt),
          preparationMs: startedAt == null ? 0 : Math.round(performance.now() - startedAt),
          ...diagnosticErrorData(error),
        });
        return;
      }
    }

    const network = await currentNetworkState().catch(() => null);
    if (network?.isConnected === false) {
      await patch(uploadRecording.id, {
        status: 'failed',
        failReason: 'device offline',
        uploadProgress: undefined,
        uploadAttempt: undefined,
        uploadRetrying: undefined,
        permanent: false,
        resumable: true,
      }, epoch);
      return;
    }

    if (uploadRecording.guestId) {
      if (!isCurrent(epoch, accountId)) return;
      try {
        // An offline-created guest must reach the server before its trial can
        // reference that UUID. This is a tiny idempotent request and is always
        // attempted before sending the much larger video bytes.
        await ensureGuestSyncedForAccount(accountId, uploadRecording.guestId);
      } catch (error) {
        await patch(uploadRecording.id, {
          status: 'failed',
          failReason: error instanceof Error ? error.message : String(error),
          uploadProgress: undefined,
          uploadAttempt: undefined,
          uploadRetrying: undefined,
          permanent: false,
          resumable: true,
        }, epoch);
        recordDiagnostic('guest_sync_blocked_upload', diagnosticErrorData(error));
        return;
      }
    }

    const finalPatch = await driveOnce(uploadRecording, {
      signal,
      expectedAccountId: accountId,
      singlePoll: true,
      deferPolling: !uploadRecording.jobId,
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
      recordPipelineTransition(uploadRecording, finalPatch);
    }
  } catch (error) {
    if (!(error instanceof OperationCancelledError) && !(error instanceof FaceBlurCancelledError) && !signal.aborted) throw error;
  }
}

/** Unchanged polls must not evict privacy timings from the diagnostic ring. */
function recordPipelineTransition(before: Recording, partial: Partial<Recording>): void {
  const after = { ...before, ...partial };
  if (
    before.status === after.status &&
    before.jobId === after.jobId &&
    before.failReason === after.failReason
  ) return;
  recordDiagnostic('pipeline_state', {
    recordingId: after.id,
    status: after.status,
    ...(after.jobId ? { jobId: after.jobId } : {}),
    ...(after.failReason ? { reason: after.failReason } : {}),
  });
}

function startDrive(rec: Recording, stage: 'ingest' | 'poll'): Promise<void> {
  if (suspended || !activeAccountId) return Promise.resolve();
  if (guestWorkBlocked(activeAccountId, rec.guestId)) return Promise.resolve();
  const epoch = accountEpoch;
  const accountId = activeAccountId;
  const operationKey = `${epoch}:${rec.id}`;
  const existing = operations.get(operationKey);
  if (existing) return existing.promise;

  const controller = new AbortController();
  const promise = runDrive(rec, epoch, accountId, controller.signal)
    .catch((error) => {
      pipelineCooldowns.set(rec.id, Date.now() + 30_000);
      recordDiagnostic('pipeline_unexpected_error', {
        recordingId: rec.id,
        ...diagnosticErrorData(error),
      });
    })
    .finally(() => {
      operations.delete(operationKey);
      queueMicrotask(pumpPending);
    });
  operations.set(operationKey, { controller, promise, epoch, stage });
  return promise;
}

function pumpPending() {
  if (!cache || suspended || !activeAccountId || isBackgroundWorkPaused()) return;
  reconcileBackgroundWork();
  if (pollWakeTimer) {
    clearWorkTimeout(pollWakeTimer);
    pollWakeTimer = null;
  }
  const now = Date.now();
  for (const [id, until] of pipelineCooldowns) {
    if (until <= now) pipelineCooldowns.delete(id);
  }
  let ingestSlots = MAX_ACTIVE_INGEST;
  let pollSlots = MAX_ACTIVE_POLLS;
  for (const operation of operations.values()) {
    if (operation.stage === 'ingest') ingestSlots -= 1;
    else pollSlots -= 1;
  }
  const activeIds = new Set(
    [...operations.keys()].map((key) => key.slice(key.indexOf(':') + 1)),
  );
  for (const id of pipelineCooldowns.keys()) activeIds.add(id);
  const selected = selectPipelineBatch(cache.filter(rec => !guestWorkBlocked(activeAccountId!, rec.guestId)), {
    activeIds,
    ingestSlots,
    pollSlots,
    now,
    privacyAllowed: !isCaptureActive(),
  });
  for (const id of selected.ingestIds) {
    const recording = cache.find((item) => item.id === id);
    if (recording) void startDrive(recording, 'ingest');
  }
  for (const id of selected.pollIds) {
    const recording = cache.find((item) => item.id === id);
    if (recording) void startDrive(recording, 'poll');
  }
  const nextPollAt = cache
    .filter(
      (recording) =>
        recording.status === 'processing' &&
        recording.jobId &&
        !operations.has(`${accountEpoch}:${recording.id}`) &&
        (recording.nextPollAt ?? 0) > now,
    )
    .reduce<number | null>(
      (next, recording) => Math.min(next ?? Infinity, recording.nextPollAt!),
      null,
    );
  const nextCooldownAt = [...pipelineCooldowns.values()].reduce<number | null>(
    (next, value) => Math.min(next ?? Infinity, value),
    null,
  );
  const nextWakeAt = Math.min(nextPollAt ?? Infinity, nextCooldownAt ?? Infinity);
  if (Number.isFinite(nextWakeAt)) {
    pollWakeTimer = setWorkTimeout(pumpPending, Math.max(50, nextWakeAt - now));
  }
}

const backgroundBatchIds = new Set<string>();
let finishingBackground: Promise<void> | undefined;
let backgroundReconcileAgain = false;
function reconcileBackgroundWork() {
  if (!cache || !activeAccountId) return;
  const pending = cache.filter(r => ['preparing', 'uploading', 'processing'].includes(r.status));
  pending.forEach(r => backgroundBatchIds.add(r.id));
  const batch = cache.filter(r => backgroundBatchIds.has(r.id));
  const fraction = (r: Recording) => r.status === 'done' || r.status === 'needs_retry' ? 1
    : r.status === 'preparing' ? (r.privacyBlurProgress ?? 0) * 0.75
    : r.status === 'uploading' ? 0.75 + (r.uploadProgress ?? 0) * 0.15
    : r.status === 'processing' ? 0.9 : 0;
  if (pending.length) {
    updateBackgroundWork(batch.reduce((sum, r) => sum + fraction(r), 0) / Math.max(1, batch.length), '');
  }
  if (finishingBackground) { backgroundReconcileAgain = true; return; }
  backgroundReconcileAgain = false;
  const epoch = accountEpoch;
  const accountId = activeAccountId;
  const finish = notifyReadyResults(accountId,
    () => (cache ?? []).filter(r => !guestWorkBlocked(accountId, r.guestId)),
    () => isCurrent(epoch, accountId))
    .catch(error => recordDiagnostic('result_notification_failed', diagnosticErrorData(error)))
    .finally(() => {
      if (finishingBackground !== finish) return;
      finishingBackground = undefined;
      if (backgroundReconcileAgain) { reconcileBackgroundWork(); return; }
      if (!isCurrent(epoch, accountId)) return;
      if (cache?.some(r => ['preparing', 'uploading', 'processing'].includes(r.status)) || operations.size) return;
      endBackgroundWork(!cache?.some(r => backgroundBatchIds.has(r.id) && ['failed', 'blur_failed'].includes(r.status)));
      backgroundBatchIds.clear();
    });
  finishingBackground = finish;
}

onBackgroundTick(pumpPending);
onBackgroundExpiration(() => {
  cancelOperations();
  recordDiagnostic('background_work_expired', {});
  const epoch = accountEpoch;
  void withCacheMutation(async () => {
    if (!cache || !isCurrent(epoch)) return;
    const recovered = recoverInterruptedPrivacyWork(cache);
    if (!recovered.recoveredIds.length) return;
    // Surface the existing Resume processing action if the OS/user stops the
    // lease. Never leave an idle model displaying "De-identifying" forever.
    cache = recovered.recordings;
    await persist(epoch);
    emit();
  }).catch(error => recordDiagnostic('background_recovery_failed', diagnosticErrorData(error)));
});

subscribeCaptureActivity((active) => {
  if (active && cache) {
    for (const [key, operation] of operations) {
      const recordingId = key.slice(key.indexOf(':') + 1);
      const recording = cache.find((item) => item.id === recordingId);
      if (operation.stage === 'ingest' && recording?.status === 'preparing') {
        operation.controller.abort();
      }
    }
  } else if (!active) {
    pumpPending();
  }
});

async function performRefreshFromServer(
  guestId?: string,
  expectedEpoch: number = accountEpoch,
): Promise<void> {
  if (!isCurrent(expectedEpoch)) return;
  const accountId = activeAccountId;
  if (!accountId) return;
  if (guestId && deletedGuestIds(accountId).has(guestId)) return;
  let response: Awaited<ReturnType<typeof fetchOwnedTrials>>;
  try {
    response = await fetchOwnedTrials(guestId, accountId);
  } catch (error) {
    // A brand-new Clerk session can render children just before AuthGate's
    // idempotent onboarding request finishes. Complete it and retry once.
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      error.responseBody.includes('not_onboarded')
    ) {
      await ensurePatientOnboarded(accountId);
      response = await fetchOwnedTrials(guestId, accountId);
    } else {
      throw error;
    }
  }
  if (!isCurrent(expectedEpoch)) return;
  // Read the cache after the network response so concurrent personal/guest
  // refreshes preserve the scope that finished first instead of reviving a
  // stale pre-request snapshot.
  let localUrisToDelete: string[] = [];
  await withCacheMutation(async () => {
    const local = await ensureLoaded();
    if (!isCurrent(expectedEpoch)) return;
    if (guestId && deletedGuestIds(accountId).has(guestId)) return;
    const merged = mergeTrialScope(local, response.trials, guestId);
    cache = merged.recordings;
    localUrisToDelete = merged.localUrisToDelete;
    await persist(expectedEpoch);
    if (!isCurrent(expectedEpoch)) return;
    emit();
  });
  await Promise.all(
    localUrisToDelete.map((uri) => deleteRecordingFile(uri).catch(() => {})),
  );
}

function refreshFromServer(
  guestId?: string,
  expectedEpoch: number = accountEpoch,
): Promise<void> {
  const key = `${expectedEpoch}:${guestId ?? 'self'}`;
  const existing = refreshRequests.get(key);
  if (existing) return existing;
  const request = performRefreshFromServer(guestId, expectedEpoch).finally(() => {
    if (refreshRequests.get(key) === request) refreshRequests.delete(key);
  });
  refreshRequests.set(key, request);
  return request;
}

function cancelOperations() {
  if (pollWakeTimer) {
    clearWorkTimeout(pollWakeTimer);
    pollWakeTimer = null;
  }
  pipelineCooldowns.clear();
  for (const operation of operations.values()) operation.controller.abort();
  endBackgroundWork(false);
  backgroundBatchIds.clear();
}

/**
 * Stop every account-bound background task without deleting any local bytes.
 * Clerk can revoke a session remotely, bypassing the explicit logout path;
 * blank global presentation state immediately so a later account can never
 * inherit the previous account's cache or retry queue.
 */
export function suspendRecordingAccessForAuthLoss(): void {
  if (suspended && activeAccountId == null) return;
  suspended = true;
  accountEpoch += 1;
  cancelOperations();
  void dismissResultNotifications().catch(() => {});
  activeAccountId = null;
  requestedAccountId = null;
  activationPromise = null;
  loadPromise = null;
  cache = null;
  activateGuestAccount(null);
  emit();
}

function recoverInterruptedPrivacyWork(recordings: Recording[]): {
  recordings: Recording[];
  recoveredIds: string[];
} {
  const recoveredIds: string[] = [];
  const recovered = recordings.map((recording) => {
    if (
      recording.status !== 'preparing' ||
      recording.privacyBlurState !== 'processing'
    ) return recording;

    recoveredIds.push(recording.id);
    return {
      ...recording,
      status: 'blur_failed' as const,
      privacyBlurState: 'failed' as const,
      privacyBlurProgress: undefined,
      failReason: 'Video privacy processing was interrupted.',
      permanent: false,
      resumable: true,
    };
  });
  return { recordings: recovered, recoveredIds };
}

async function activateAccount(accountId: string): Promise<void> {
  if (activeAccountId === accountId && cache && !suspended) return;
  if (requestedAccountId === accountId && activationPromise) return activationPromise;

  requestedAccountId = accountId;
  const activation = (async () => {
    cancelOperations();
    accountEpoch += 1;
    const epoch = accountEpoch;
    activeAccountId = accountId;
    activateGuestAccount(accountId);
    suspended = false;
    allowBackgroundWork();
    cache = null;
    loadPromise = null;
    await loadDeletedGuests(accountId);
    let loaded = await ensureLoaded();
    if (!isCurrent(epoch, accountId)) return;
    for (const guestId of deletedGuestIds(accountId)) {
      await clearGuestCaptureIntent(accountId, guestId);
      if (loaded.some(recording => recording.guestId === guestId)) await purgeGuestRecordings(accountId, guestId);
    }
    loaded = await ensureLoaded();
    await excludeRecordingsFromBackup().catch((error) => {
      recordDiagnostic('recording_backup_exclusion_failed', diagnosticErrorData(error));
    });
    await clearRecordingExportTemps().catch(() => {});
    const recovered = recoverInterruptedPrivacyWork(loaded);
    if (recovered.recoveredIds.length > 0) {
      cache = recovered.recordings;
      schedulePersist(epoch);
      if (!isCurrent(epoch, accountId)) return;
      recordDiagnostic('privacy_blur_interrupted', {
        recordingIds: recovered.recoveredIds.join(','),
      });
    }
    for (const recording of cache ?? []) {
      if (['preparing', 'uploading', 'processing'].includes(recording.status) && recording.originalVideoUri) {
        await armResultNotification(accountId, recording).catch(error => recordDiagnostic('notification_arm_failed', diagnosticErrorData(error)));
      }
    }
    const interruptedCapture = await recoverCaptureIntent(accountId);
    if (interruptedCapture && isCurrent(epoch, accountId)) {
      try {
        await stage(
          interruptedCapture.testId,
          interruptedCapture.sourceUri,
          interruptedCapture.evaluatedSide,
          interruptedCapture.guestId,
          interruptedCapture.evaluationRun,
          accountId,
        );
        await clearCaptureIntent(accountId);
        recordDiagnostic('capture_recovered', { testId: interruptedCapture.testId });
      } catch (error) {
        recordDiagnostic('capture_recovery_failed', diagnosticErrorData(error));
      }
    }
    emit();
    // Local storage is enough to render the list/empty state. Do not make the
    // screen's loading flag wait on a network request that can be slow or
    // offline; merge cloud history in the background when it arrives.
    resumePending();
    void refreshFromServer(undefined, epoch)
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

function stage(
  testId: TestId,
  videoUri: string,
  evaluatedSide?: EvaluatedSide,
  guestId?: string,
  evaluationRun?: EvaluationRunRef,
  expectedAccountId?: string,
): Promise<Recording> {
  const key = guestId && expectedAccountId ? guestWorkKey(expectedAccountId, guestId) : null;
  const pending = key ? guestStages.get(key) ?? new Set<Promise<Recording>>() : null;
  const operation = stageRecordingFile(testId, videoUri, evaluatedSide, guestId, evaluationRun, expectedAccountId)
    .finally(() => {
      pending?.delete(operation);
      if (key && pending?.size === 0) guestStages.delete(key);
    });
  if (key && pending) { pending.add(operation); guestStages.set(key, pending); }
  return operation;
}

async function stageRecordingFile(
  testId: TestId,
  videoUri: string,
  evaluatedSide?: EvaluatedSide,
  guestId?: string,
  evaluationRun?: EvaluationRunRef,
  expectedAccountId?: string,
): Promise<Recording> {
  if (
    !expectedAccountId ||
    activeAccountId !== expectedAccountId ||
    requestedAccountId !== expectedAccountId ||
    suspended
  ) {
    throw new Error('recording account changed');
  }
  await ensureLoaded();
  const epoch = accountEpoch;
  if (guestWorkBlocked(expectedAccountId, guestId)) throw new Error('guest unavailable');
  const id = makeId();
  const durableUri = recordingFileUri(videoUri, id);
  const sourceSize = await recordingFileSize(videoUri);
  if (!sourceSize || sourceSize <= 0) throw new Error('camera recording is missing or empty');
  const privacyBlur = await getPrivacyBlurSettings();
  const privacyRequested = privacyBlur.face || privacyBlur.background;
  const provisional: Recording = {
    id,
    testId,
    guestId,
    evaluatedSide,
    evaluationRun,
    createdAt: Date.now(),
    localRevision: 1,
    videoUri: durableUri,
    originalVideoUri: durableUri,
    stagingSourceUri: videoUri,
    stagingSourceSize: sourceSize,
    status: 'draft',
    faceBlurRequested: privacyBlur.face,
    backgroundBlurRequested: privacyBlur.background,
    privacyBlurState: privacyRequested ? 'pending' : undefined,
  };
  if (!isCurrent(epoch, expectedAccountId)) throw new Error('recording account changed');
  // Write the recovery descriptor before moving the camera file. A kill after
  // the move can therefore always rediscover the durable destination.
  await persistRecordingManifest(expectedAccountId, provisional);
  try {
    await persistRecordingFile(videoUri, id);
  } catch (error) {
    // The move may have completed before a transient metadata read failed.
    // Keep the provisional source/destination manifest so relaunch can verify
    // either location and recover the only original.
    throw error;
  }
  const rec: Recording = {
    ...provisional,
    localRevision: 2,
    stagingSourceUri: undefined,
    stagingSourceSize: undefined,
  };
  await persistRecordingManifest(expectedAccountId, rec);
  if (!isCurrent(epoch, expectedAccountId)) {
    // The manifest is bound to the initiating account and the original is now
    // durable. Never delete either during an account transition; activation of
    // that account will recover it into its aggregate index.
    throw new Error('recording account changed');
  }
  try {
    await withCacheMutation(async () => {
      if (!isCurrent(epoch, expectedAccountId)) throw new Error('recording account changed');
      const current = await ensureLoaded();
      cache = [rec, ...current];
      schedulePersist(epoch);
      if (isCurrent(epoch, expectedAccountId)) emit();
    });
  } catch (error) {
    if (!isCurrent(epoch, expectedAccountId)) throw error;
    await withCacheMutation(async () => {
      if (!isCurrent(epoch, expectedAccountId)) throw new Error('recording account changed');
      if (!(cache ?? []).some((recording) => recording.id === id)) {
        cache = [rec, ...(cache ?? [])];
      }
      emit();
    });
    // The video and manifest are already durable. Treat aggregate-index failure
    // as degraded metadata redundancy, not as a failed/lost recording.
    recordDiagnostic('recording_index_write_failed', diagnosticErrorData(error));
  }
  recordDiagnostic('recording_saved', {
    recordingId: id,
    testId,
    uri: 'documents',
    staged: true,
  });
  await clearCaptureIntent(expectedAccountId).catch(() => {});
  return rec;
}

async function finalizeDraft(id: string): Promise<Recording> {
  const epoch = accountEpoch;
  const accountId = activeAccountId;
  const existing = (await ensureLoaded()).find((recording) => recording.id === id);
  if (!accountId || !isCurrent(epoch, accountId)) throw new Error('recording account changed');
  if (!existing) throw new Error('saved recording unavailable');
  if (AppState.currentState === 'active') allowBackgroundWork();
  await armResultNotification(accountId, existing).catch(error => recordDiagnostic('notification_arm_failed', diagnosticErrorData(error)));
  void requestResultNotifications().catch(error => recordDiagnostic('notification_permission_failed', diagnosticErrorData(error)));
  if (existing.status === 'draft') {
    const privacyRequested = recordingRequestsPrivacy(existing);
    try {
      await patch(id, {
        status: privacyRequested ? 'preparing' : 'uploading',
        privacyBlurState: privacyRequested ? 'pending' : undefined,
        privacyBlurProgress: privacyRequested ? 0 : undefined,
        uploadProgress: privacyRequested ? undefined : 0,
        uploadAttempt: privacyRequested ? undefined : 1,
        uploadRetrying: privacyRequested ? undefined : false,
        failReason: undefined,
      }, epoch);
    } catch (error) {
      if ((cache ?? []).find((recording) => recording.id === id)?.status !== 'preparing') {
        throw error;
      }
      recordDiagnostic('recording_index_write_failed', diagnosticErrorData(error));
    }
  }
  // Commit the new clip before changing previous attempts. A crash between
  // these writes is repaired from the durable manifests during loading.
  await withCacheMutation(async () => {
    if (!isCurrent(epoch, accountId)) throw new Error('recording account changed');
    const current = await ensureLoaded();
    const next = supersedeCheckupRetakes(current);
    for (let index = 0; index < next.length; index++) {
      if (next[index] !== current[index]) await persistRecordingManifest(accountId, next[index]);
    }
    if (!isCurrent(epoch)) throw new Error('recording account changed');
    cache = next;
    schedulePersist(epoch);
    emit();
  });
  const finalized = (cache ?? []).find((recording) => recording.id === id);
  if (!finalized) throw new Error('saved recording unavailable');
  resumePending();
  return finalized;
}

async function add(
  testId: TestId,
  videoUri: string,
  evaluatedSide?: EvaluatedSide,
  guestId?: string,
  evaluationRun?: EvaluationRunRef,
  expectedAccountId?: string,
): Promise<Recording> {
  const staged = await stage(
    testId,
    videoUri,
    evaluatedSide,
    guestId,
    evaluationRun,
    expectedAccountId,
  );
  return finalizeDraft(staged.id);
}

function operationForRecording(id: string) {
  return operations.get(`${accountEpoch}:${id}`);
}

async function removeById(id: string) {
  const accountId = activeAccountId;
  const epoch = accountEpoch;
  if (!accountId || !isCurrent(epoch, accountId)) {
    throw new Error('recording account unavailable');
  }
  const list = await ensureLoaded();
  const recording = list.find((item) => item.id === id);
  if (!recording) return;
  if (operationForRecording(id) && !recording.jobId) {
    throw new Error('recording upload is still being finalized');
  }
  let jobId = recording.jobId;
  if (!jobId && recording.uploadId) {
    const pendingResult = await deleteRemoteUpload(recording.uploadId, accountId);
    if (pendingResult === 'consumed') {
      const recovered = await createAnalysisTrial(
        recording.uploadId,
        recording.testId,
        recording.id,
        recording.createdAt,
        recording.evaluatedSide,
        recording.guestId,
        recording.evaluationRun,
        undefined,
        accountId,
      );
      jobId = recovered.jobId;
    }
  }
  if (jobId) await deleteRemoteRecording(jobId, accountId);
  if (!isCurrent(epoch, accountId)) throw new Error('recording account changed');
  if (recording.videoUri) await deleteRecordingFile(recording.videoUri);
  if (recording.originalVideoUri && recording.originalVideoUri !== recording.videoUri) {
    await deleteRecordingFile(recording.originalVideoUri);
  }
  if (
    recording.privacyBlurOriginalUri &&
    recording.privacyBlurOriginalUri !== recording.videoUri
  ) {
    await deleteRecordingFile(recording.privacyBlurOriginalUri);
  }
  await deletePrivacyBlurArtifacts(recording.id);
  await deleteRecordingManifest(recording.id);
  await withCacheMutation(async () => {
    const current = await ensureLoaded();
    cache = current.filter((item) => item.id !== id);
    await persist();
    emit();
  });
  recordDiagnostic('recording_deleted', {
    recordingId: id,
    remote: Boolean(jobId || recording.uploadId),
  });
}

export async function guestRecordingsForDeletion(accountId: string, guestId: string): Promise<Recording[]> {
  const epoch = accountEpoch;
  if (!isCurrent(epoch, accountId)) throw new Error('recording account changed');
  const records = await ensureLoaded();
  // A capture interrupted during its move may have only a recovery manifest.
  const manifests = await readRecordingManifests(accountId);
  if (!isCurrent(epoch, accountId)) throw new Error('recording account changed');
  const byId = new Map([...manifests, ...records].map(recording => [recording.id, recording]));
  return [...byId.values()].filter(recording => recording.guestId === guestId);
}

/** Stop this person's uploads/preprocessing before deleting any of their bytes. */
export async function pauseGuestRecordings(accountId: string, guestId: string): Promise<() => void> {
  const key = guestWorkKey(accountId, guestId);
  pausedGuests.set(key, (pausedGuests.get(key) ?? 0) + 1);
  const release = () => {
    const count = (pausedGuests.get(key) ?? 1) - 1;
    if (count > 0) pausedGuests.set(key, count); else pausedGuests.delete(key);
    pumpPending();
  };
  try {
    // Finish already-started camera moves before taking the final count or
    // removing originals. New stages are blocked by pausedGuests above.
    await Promise.allSettled([...(guestStages.get(key) ?? [])]);
    const records = await guestRecordingsForDeletion(accountId, guestId);
    const pending = records.flatMap(recording => {
      const operation = operationForRecording(recording.id);
      if (!operation) return [];
      operation.controller.abort();
      return [operation.promise];
    });
    await Promise.allSettled(pending);
    await cacheMutationTail;
    return release;
  } catch (error) { release(); throw error; }
}

export function purgeGuestRecordings(accountId: string, guestId: string): Promise<void> {
  const key = guestWorkKey(accountId, guestId);
  const existing = guestPurges.get(key);
  if (existing) return existing;
  const operation = (async () => {
    if (!(await loadDeletedGuests(accountId)).has(guestId)) throw new Error('guest deletion not confirmed');
    const release = await pauseGuestRecordings(accountId, guestId);
    const epoch = accountEpoch;
    try {
      const recordings = await guestRecordingsForDeletion(accountId, guestId);
      await clearGuestCaptureIntent(accountId, guestId);
      for (const recording of recordings) {
        const uris = new Set([recording.videoUri, recording.originalVideoUri, recording.privacyBlurOriginalUri, recording.stagingSourceUri]);
        for (const uri of uris) if (uri) await deleteRecordingFile(uri);
        await deletePrivacyBlurArtifacts(recording.id);
        await deleteRecordingManifest(recording.id);
      }
      await withCacheMutation(async () => {
        if (!isCurrent(epoch, accountId)) throw new Error('recording account changed');
        cache = (await ensureLoaded()).filter(recording => recording.guestId !== guestId);
        // Both A/B index generations must forget the deleted recordings.
        await persist(epoch);
        await persist(epoch);
        await AsyncStorage.removeItem(storageKey(accountId));
        emit();
      });
    } finally { release(); }
  })().finally(() => guestPurges.delete(key));
  guestPurges.set(key, operation);
  return operation;
}

subscribeGuestDeletion((accountId, guestId) => {
  if (activeAccountId !== accountId || suspended) return;
  emit();
  void purgeGuestRecordings(accountId, guestId).catch(error => recordDiagnostic('guest_cleanup_failed', diagnosticErrorData(error)));
});

function resumePending() {
  // Running operations also need a new lease after a failed foreground start;
  // they will not pass through runDrive again merely because the app reopened.
  if (cache && !suspended && AppState.currentState === 'active' &&
      cache.some(r => ['preparing', 'uploading', 'processing'].includes(r.status))) {
    void ensureBackgroundWork();
  }
  if (!cache || suspended || resumePromise) {
    pumpPending();
    return;
  }
  const epoch = accountEpoch;
  const run = withCacheMutation(async () => {
    if (!cache || !isCurrent(epoch)) return;
    let changed = false;
    cache = cache.map((recording) => {
      if (recording.status === 'preparing' && recording.privacyBlurState === 'processing' && !operationForRecording(recording.id)) {
        changed = true;
        return { ...recording, privacyBlurState: 'pending' as const, privacyBlurProgress: undefined };
      }
      if (recording.status !== 'failed' || !recording.resumable) return recording;
      changed = true;
      return {
        ...recording,
        status: recording.uploadId ? 'processing' as const : 'uploading' as const,
        uploadProgress: recording.uploadId ? undefined : 0,
        uploadAttempt: recording.uploadId ? undefined : 1,
        uploadRetrying: false,
        failReason: undefined,
        permanent: undefined,
        resumable: undefined,
        localRevision: (recording.localRevision ?? 0) + 1,
      };
    });
    if (changed) {
      await persist(epoch);
      if (isCurrent(epoch)) emit();
    }
  }).finally(() => {
    if (resumePromise === run) resumePromise = null;
    pumpPending();
  });
  resumePromise = run;
}

async function resume(id: string) {
  const existing = (await ensureLoaded()).find((recording) => recording.id === id);
  if (!existing) return;
  if (
    recordingRequestsPrivacy(existing) &&
    existing.privacyBlurState !== 'completed'
  ) {
    await retryPrivacyBlur(id);
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
  pumpPending();
}

async function retryPrivacyBlur(id: string) {
  const existing = (await ensureLoaded()).find((recording) => recording.id === id);
  if (
    (!existing?.videoUri && !existing?.originalVideoUri) ||
    existing.uploadId ||
    existing.jobId
  ) return;
  if (AppState.currentState === 'active') allowBackgroundWork();
  if (activeAccountId) {
    await armResultNotification(activeAccountId, existing).catch(error => recordDiagnostic('notification_arm_failed', diagnosticErrorData(error)));
    void requestResultNotifications().catch(error => recordDiagnostic('notification_permission_failed', diagnosticErrorData(error)));
  }
  await patch(id, {
    status: 'preparing',
    videoUri: existing.originalVideoUri ?? existing.videoUri,
    privacyBlurState: 'pending',
    privacyBlurProgress: 0,
    failReason: undefined,
    permanent: undefined,
    resumable: undefined,
  });
  pumpPending();
}

/** Cancel all local work, delete every app-owned clip, and clear this account's cache. */
async function purgeForLogout(): Promise<void> {
  const accountId = activeAccountId;
  if (!accountId) return;
  suspended = true;
  accountEpoch += 1;
  cancelOperations();
  const snapshotTimer = snapshotTimers.get(accountId);
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimers.delete(accountId);
  pendingSnapshots.delete(accountId);
  await Promise.allSettled([...operations.values()].map((operation) => operation.promise));
  await cacheMutationTail.catch(() => {});
  await persistTail.catch(() => {});
  await clearAllCaptureIntentsAndFiles();
  await deleteAllRecordingFiles();
  await clearRecordingExportTemps();
  await clearAllGuestCaches();
  await clearSelfProfiles();
  const recordingKeys = (await AsyncStorage.getAllKeys()).filter(
    (key) =>
      key === LEGACY_STORAGE_KEY ||
      key.startsWith(STORAGE_KEY_PREFIX) ||
      key.startsWith(CHUNK_STORAGE_KEY_PREFIX),
  );
  if (recordingKeys.length > 0) await AsyncStorage.multiRemove(recordingKeys);
  cache = [];
  loadPromise = null;
  activeAccountId = null;
  activateGuestAccount(null);
  requestedAccountId = null;
  emit();
}

export function useRecordings(
  scope: { guestId?: string; includeGuests?: boolean } = {},
) {
  const { user } = useUser();
  const network = useNetworkState();
  const accountId = user?.id ?? null;
  const { guestId, includeGuests = false } = scope;
  const [allRecordings, setAllRecordings] = useState<Recording[]>(
    accountId && activeAccountId === accountId && !suspended ? [...(cache ?? [])] : [],
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const sync = () => {
      if (mounted) setAllRecordings(cache ? [...cache] : []);
    };
    listeners.add(sync);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (
        state !== 'active' ||
        !accountId ||
        activeAccountId !== accountId ||
        suspended
      ) return;
      const epoch = accountEpoch;
      allowBackgroundWork();
      void refreshFromServer(guestId, epoch).catch((error) => {
        recordDiagnostic('recording_sync_failed', diagnosticErrorData(error));
      });
      resumePending();
    });

    if (accountId) {
      // A component can survive a direct Clerk A→B switch. Never render the
      // process-global A cache while B's asynchronous storage activation runs.
      if (activeAccountId !== accountId || suspended) setAllRecordings([]);
      setLoading(true);
      void activateAccount(accountId)
        .then(() => {
          if (!mounted) return;
          // Local storage renders immediately; guest cloud history merges in
          // the background just like personal history does at activation.
          sync();
          setLoading(false);
          if (guestId) {
            void refreshFromServer(guestId).catch((error) => {
              recordDiagnostic('recording_sync_failed', diagnosticErrorData(error));
            });
          }
        })
        .catch((error) => {
          recordDiagnostic('recording_sync_failed', diagnosticErrorData(error));
          if (!mounted) return;
          sync();
          setLoading(false);
        });
    } else {
      setAllRecordings([]);
      setLoading(false);
    }
    return () => {
      mounted = false;
      listeners.delete(sync);
      appStateSubscription.remove();
    };
  }, [accountId, guestId]);

  // Resume queued local clips when the phone changes network state. We don't
  // gate on isInternetReachable because Android connectivity probes can be
  // blocked even while Luche's fallback API route is healthy.
  useEffect(() => {
    if (!accountId || network.isConnected === false) return;
    resumePending();
  }, [accountId, network.isConnected, network.isInternetReachable, network.type]);

  const addRecording = useCallback(
    (
      testId: TestId,
      videoUri: string,
      evaluatedSide?: EvaluatedSide,
      guestId?: string,
      evaluationRun?: EvaluationRunRef,
    ) => {
      if (!accountId) return Promise.reject(new Error('recording account unavailable'));
      return add(testId, videoUri, evaluatedSide, guestId, evaluationRun, accountId);
    },
    [accountId],
  );
  const stageRecording = useCallback(
    (
      testId: TestId,
      videoUri: string,
      evaluatedSide?: EvaluatedSide,
      guestId?: string,
      evaluationRun?: EvaluationRunRef,
    ) => {
      if (!accountId) return Promise.reject(new Error('recording account unavailable'));
      return stage(testId, videoUri, evaluatedSide, guestId, evaluationRun, accountId);
    },
    [accountId],
  );
  const finalizeRecording = useCallback(finalizeDraft, []);
  const remove = useCallback(removeById, []);
  const retry = useCallback((id: string) => void resume(id), []);
  const retryPrivacyBlurring = useCallback((id: string) => void retryPrivacyBlur(id), []);
  const refresh = useCallback(() => refreshFromServer(guestId), [guestId]);
  const logoutAndPurge = useCallback(() => purgeForLogout(), []);
  const restoreAfterFailedPurge = useCallback(
    () => (accountId ? activateAccount(accountId) : Promise.resolve()),
    [accountId],
  );
  const unuploadedCount = useMemo(
    () => allRecordings.filter((recording) => recording.videoUri && !recording.jobId).length,
    [allRecordings],
  );
  const recordings = useMemo(() => {
    const available = accountId ? allRecordings.filter(recording => !recording.guestId || !deletedGuestIds(accountId).has(recording.guestId)) : [];
    if (includeGuests) return available;
    return available.filter((recording) => recording.guestId === guestId);
  }, [accountId, allRecordings, guestId, includeGuests]);

  return {
    recordings,
    loading,
    addRecording,
    stageRecording,
    finalizeRecording,
    remove,
    retry,
    retryPrivacyBlurring,
    refresh,
    logoutAndPurge,
    restoreAfterFailedPurge,
    unuploadedCount,
  };
}

export const __testing = {
  activateAccount,
  stage,
  finalizeDraft,
  patch,
  ensureLoaded,
  driveOnce,
  resumePending,
  reconcileBackgroundWork,
  recordPipelineTransition,
  recoverInterruptedPrivacyWork,
  serializeCacheMutation: withCacheMutation,
  readRecordingSnapshot,
  writeRecordingSnapshot,
  chunkStoragePrefix,
};
