import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { pollResult, uploadRecording } from './cloud';
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
 *  pass 0). Permanent errors abort immediately. Returns the jobId. */
async function uploadWithRetry(
  rec: Recording,
  maxBackoffs: number = UPLOAD_BACKOFFS_MS.length,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxBackoffs; attempt++) {
    try {
      const res = await uploadRecording(rec.videoUri, rec.testId, rec.id, rec.createdAt);
      return res.jobId;
    } catch (e) {
      lastErr = e;
      if (classifyUploadError(e) === 'permanent') throw e;
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
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache ?? []));
}

async function ensureLoaded(): Promise<Recording[]> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  cache = raw ? (JSON.parse(raw) as Recording[]) : [];
  return cache;
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

/** Pure lifecycle core: runs the upload→poll for one recording and RETURNS the
 *  patch to apply. No persistence, so it's unit-testable. `opts.maxBackoffs`
 *  lets tests disable backoff. */
async function driveOnce(
  rec: Recording,
  opts: { maxBackoffs?: number; onUploaded?: (jobId: string) => Promise<void> | void } = {},
): Promise<Partial<Recording>> {
  let jobId = rec.jobId;
  let phase: 'upload' | 'poll' = 'upload';
  try {
    if (rec.status === 'uploading' || !jobId) {
      jobId = await serialUpload(() => uploadWithRetry(rec, opts.maxBackoffs));
      // Persist the upload→processing transition NOW: the byte-upload is done
      // (app no longer needs to stay open) and jobId must survive a kill during
      // the poll so resume re-polls instead of re-uploading.
      await opts.onUploaded?.(jobId);
    }
    phase = 'poll';
    const result = await pollResult(jobId, rec.testId);
    return { status: 'done', jobId, result };
  } catch (e) {
    if (e instanceof PollTimeoutError) {
      // Server may still finish — keep processing so resumePending re-polls.
      return { status: 'processing', jobId };
    }
    const permanent = classifyUploadError(e) === 'permanent';
    return {
      status: 'failed',
      failReason: e instanceof Error ? e.message : String(e),
      permanent,
      resumable: phase === 'upload' && !permanent,
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
      onUploaded: (jobId) => patch(rec.id, { status: 'processing', jobId }),
    });
    await patch(rec.id, patch_);
  } finally {
    inFlight.delete(rec.id);
  }
}

// --- Public store operations ---------------------------------------------------

async function add(testId: TestId, videoUri: string): Promise<Recording> {
  const list = await ensureLoaded();
  const rec: Recording = {
    id: makeId(),
    testId,
    createdAt: Date.now(),
    videoUri,
    status: 'uploading',
  };
  cache = [rec, ...list];
  await persist();
  emit();
  // Fire-and-forget the placeholder upload/processing pipeline.
  void drive(rec);
  return rec;
}

async function removeById(id: string) {
  const list = await ensureLoaded();
  cache = list.filter((r) => r.id !== id);
  await persist();
  emit();
}

/** Re-drive any recording left un-finished, and auto-resume upload-phase
 *  failures from a prior session. Permanent + analysis failures wait for a
 *  manual Retry tap. */
function resumePending() {
  if (!cache) return;
  for (const r of cache) {
    if (r.status === 'uploading' || r.status === 'processing') void drive(r);
    else if (r.status === 'failed' && r.resumable) void restart(r.id);
  }
}

/** Reset a recording to a fresh upload and drive it. Used by resume and the
 *  manual Retry button. Clearing jobId forces a fresh upload + new trial. */
async function restart(id: string) {
  await patch(id, {
    status: 'uploading',
    jobId: undefined,
    failReason: undefined,
    permanent: undefined,
    resumable: undefined,
  });
  const rec = (cache ?? []).find((r) => r.id === id);
  if (rec) void drive({ ...rec, status: 'uploading', jobId: undefined });
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
    ensureLoaded().then(() => {
      if (!mounted) return;
      setLoading(false);
      sync();
      resumePending();
    });
    return () => {
      mounted = false;
      listeners.delete(sync);
    };
  }, []);

  const addRecording = useCallback(add, []);
  const remove = useCallback(removeById, []);
  const retry = useCallback((id: string) => void restart(id), []);

  return { recordings, loading, addRecording, remove, retry };
}

export const __testing = { driveOnce };
