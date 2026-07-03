import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { pollResult, uploadRecording } from './cloud';
import type { TestId } from './tests';
import type { Recording } from './types';

const STORAGE_KEY = 'luche.recordings.v1';

// --- Module-level shared store -------------------------------------------------
// A single in-memory cache backed by AsyncStorage, with a tiny subscription
// system so every mounted useRecordings() hook re-renders on any change. Avoids
// each screen holding a divergent copy of the list.

let cache: Recording[] | null = null;
const listeners = new Set<() => void>();
// Guards against driving the same recording's pipeline twice concurrently.
const inFlight = new Set<string>();

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

/**
 * Walks one recording through the placeholder cloud lifecycle, persisting each
 * transition. Re-entrant-safe: works whether the record is still `uploading`
 * (fresh) or was left mid-`processing` by an app restart.
 */
async function drive(rec: Recording) {
  if (inFlight.has(rec.id)) return;
  inFlight.add(rec.id);
  try {
    let jobId = rec.jobId;
    if (rec.status === 'uploading' || !jobId) {
      const res = await uploadRecording(rec.videoUri, rec.testId, rec.id, rec.createdAt);
      jobId = res.jobId;
      await patch(rec.id, { status: 'processing', jobId });
    }
    const result = await pollResult(jobId, rec.testId);
    await patch(rec.id, { status: 'done', result });
  } catch {
    await patch(rec.id, { status: 'failed' });
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

/** Re-drive any recording left un-finished (e.g. app killed mid-processing). */
function resumePending() {
  if (!cache) return;
  for (const r of cache) {
    if (r.status === 'uploading' || r.status === 'processing') void drive(r);
  }
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

  return { recordings, loading, addRecording, remove };
}
