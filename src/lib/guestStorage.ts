import { useUser } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { diagnosticErrorData, recordDiagnostic } from './diagnostics';
import {
  createGuest as createRemoteGuest,
  fetchGuest as fetchRemoteGuest,
  fetchGuests as fetchRemoteGuests,
  type Guest,
} from './guests';
import { createConcurrencyQueue } from './uploadRetry';

const STORAGE_KEY_PREFIX = 'luche.guests.v1.';
const CHUNK_STORAGE_KEY_PREFIX = 'luche.guests.v2.';
const ITEM_STORAGE_KEY_PREFIX = 'luche.guests.v3.';

type GuestSnapshotManifest = {
  version: 2;
  generation: number;
  count: number;
  chunks: number;
};

export interface StoredGuest extends Guest {
  /** Local fields have not yet been idempotently committed to the API. */
  pendingSync?: boolean;
  /** Monotonic local edit generation used to avoid overwriting a newer edit. */
  localRevision?: number;
  /** Internal A/B record generation; never sent to the API. */
  storageGeneration?: number;
}

const caches = new Map<string, StoredGuest[]>();
const loadPromises = new Map<string, Promise<StoredGuest[]>>();
const mutationTails = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<() => void>>();
const syncOperations = new Map<string, Promise<StoredGuest>>();
const snapshotGenerations = new Map<string, number>();
let generation = 0;
let activeGuestAccountId: string | null = null;
// A large event may create one offline profile per participant. Reconnect them
// in a small batch instead of firing a hundred authenticated writes at once.
const limitedGuestSync = createConcurrencyQueue(4);

function assertActiveGuestAccount(accountId: string, expectedGeneration: number): void {
  if (activeGuestAccountId !== accountId || generation !== expectedGeneration) {
    throw new Error('guest sync cancelled');
  }
}

/** Invalidate queued network work before a Clerk account transition can reuse it. */
export function activateGuestAccount(accountId: string | null): void {
  if (activeGuestAccountId === accountId) return;
  generation += 1;
  activeGuestAccountId = accountId;
  syncOperations.clear();
}

function storageKey(accountId: string): string {
  return `${STORAGE_KEY_PREFIX}${accountId}`;
}

function chunkStoragePrefix(accountId: string): string {
  return `${CHUNK_STORAGE_KEY_PREFIX}${encodeURIComponent(accountId)}.`;
}

function guestItemPrefix(accountId: string): string {
  return `${ITEM_STORAGE_KEY_PREFIX}${encodeURIComponent(accountId)}.`;
}

function guestItemKey(accountId: string, guestId: string, slot: number): string {
  return `${guestItemPrefix(accountId)}${encodeURIComponent(guestId)}.${slot}`;
}

function manifestKey(accountId: string, slot: number): string {
  return `${chunkStoragePrefix(accountId)}manifest.${slot}`;
}

function chunkKey(accountId: string, generation: number, index: number): string {
  return `${chunkStoragePrefix(accountId)}chunk.${generation}.${index}`;
}

async function readChunkedGuestSnapshot(accountId: string): Promise<StoredGuest[] | null> {
  const manifests = await AsyncStorage.multiGet([manifestKey(accountId, 0), manifestKey(accountId, 1)]);
  const candidates = manifests
    .flatMap(([, raw]) => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as GuestSnapshotManifest;
        return parsed.version === 2 &&
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
              chunkKey(accountId, manifest.generation, index),
            ),
          );
      if (values.some(([, raw]) => raw == null)) continue;
      const guests = values.flatMap(([, raw]) => {
        const parsed = JSON.parse(raw!) as unknown;
        if (!Array.isArray(parsed)) throw new Error('invalid guest chunk');
        return parsed as StoredGuest[];
      });
      if (guests.length !== manifest.count) continue;
      snapshotGenerations.set(accountId, manifest.generation);
      return guests;
    } catch {
      // A/B manifests retain the previous complete generation if the newest
      // snapshot was interrupted or damaged.
    }
  }
  return null;
}

function sorted(guests: StoredGuest[]): StoredGuest[] {
  return [...guests].sort((a, b) => {
    const aActivity = Math.max(a.lastRecordedAt ?? 0, a.updatedAt, a.createdAt);
    const bActivity = Math.max(b.lastRecordedAt ?? 0, b.updatedAt, b.createdAt);
    return bActivity - aActivity;
  });
}

function emit(accountId: string): void {
  for (const listener of listeners.get(accountId) ?? []) listener();
}

async function loadGuests(accountId: string): Promise<StoredGuest[]> {
  const cached = caches.get(accountId);
  if (cached) return cached;

  const existing = loadPromises.get(accountId);
  if (existing) return existing;

  const loading = (async () => {
      const itemKeys = (await AsyncStorage.getAllKeys()).filter((key) =>
        key.startsWith(guestItemPrefix(accountId)),
      );
      const itemCandidates = itemKeys.length > 0
        ? (await AsyncStorage.multiGet(itemKeys)).flatMap(([, raw]) => {
            if (!raw) return [];
            try {
              const parsed = JSON.parse(raw) as StoredGuest;
              return typeof parsed?.id === 'string' && typeof parsed?.name === 'string'
                ? [parsed]
                : [];
            } catch {
              return [];
            }
          })
        : [];
      const itemsById = new Map<string, StoredGuest>();
      for (const guest of itemCandidates) {
        const existing = itemsById.get(guest.id);
        if (!existing || (guest.storageGeneration ?? 0) > (existing.storageGeneration ?? 0)) {
          itemsById.set(guest.id, guest);
        }
      }
      const chunked = await readChunkedGuestSnapshot(accountId);
      const raw = chunked == null ? await AsyncStorage.getItem(storageKey(accountId)) : null;
      const parsed = chunked ?? (raw ? (JSON.parse(raw) as StoredGuest[]) : []);
      const legacy = Array.isArray(parsed) ? parsed : [];
      const mergedById = new Map(legacy.map((guest) => [guest.id, guest]));
      for (const guest of itemsById.values()) mergedById.set(guest.id, guest);
      const guests = sorted([...mergedById.values()]);
      // Preserve the old aggregate snapshot as a migration fallback. Each
      // profile is then copied to two independent rows so all future edits
      // write only one small A/B record instead of rewriting the full list.
      caches.set(accountId, [...itemsById.values()]);
      if (legacy.some((guest) => !itemsById.has(guest.id))) {
        await persistGuests(accountId, guests);
      } else {
        caches.set(accountId, guests);
      }
      return guests;
    })().finally(() => {
      loadPromises.delete(accountId);
    });
  loadPromises.set(accountId, loading);
  return loading;
}

async function persistGuests(accountId: string, guests: StoredGuest[]): Promise<void> {
  const previous = caches.get(accountId) ?? [];
  const previousById = new Map(previous.map((guest) => [guest.id, guest]));
  const next: StoredGuest[] = [];
  const writes: [string, string][] = [];
  for (const candidate of guests) {
    const old = previousById.get(candidate.id);
    const oldComparable = old ? { ...old, storageGeneration: undefined } : null;
    const candidateComparable = { ...candidate, storageGeneration: undefined };
    if (old && JSON.stringify(oldComparable) === JSON.stringify(candidateComparable)) {
      next.push(old);
      continue;
    }
    const stored = {
      ...candidate,
      storageGeneration: (old?.storageGeneration ?? 0) + 1,
    };
    const value = JSON.stringify(stored);
    if (old) {
      writes.push([guestItemKey(accountId, stored.id, stored.storageGeneration % 2), value]);
    } else {
      // A newly created profile starts with two complete copies; subsequent
      // generations alternate slots and always retain the previous value.
      writes.push(
        [guestItemKey(accountId, stored.id, 0), value],
        [guestItemKey(accountId, stored.id, 1), value],
      );
    }
    next.push(stored);
  }
  const nextIds = new Set(next.map((guest) => guest.id));
  const removed = previous
    .filter((guest) => !nextIds.has(guest.id))
    .flatMap((guest) => [
      guestItemKey(accountId, guest.id, 0),
      guestItemKey(accountId, guest.id, 1),
    ]);
  if (writes.length > 0) await AsyncStorage.multiSet(writes);
  if (removed.length > 0) await AsyncStorage.multiRemove(removed);
  const sortedNext = sorted(next);
  caches.set(accountId, sortedNext);
  emit(accountId);
}

function withAccountLock<T>(accountId: string, task: () => Promise<T>): Promise<T> {
  const previous = mutationTails.get(accountId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  mutationTails.set(
    accountId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function withoutPendingSync(guest: StoredGuest): StoredGuest {
  const { pendingSync: _pendingSync, ...synced } = guest;
  return synced;
}

/** Save a guest before attempting any network request. */
export async function createLocalGuest(
  accountId: string,
  name: string,
  notes: string,
): Promise<StoredGuest> {
  const now = Date.now();
  const guest: StoredGuest = {
    id: Crypto.randomUUID(),
    name: name.trim(),
    notes,
    testCount: 0,
    lastRecordedAt: null,
    createdAt: now,
    updatedAt: now,
    pendingSync: true,
    localRevision: 1,
  };
  await withAccountLock(accountId, async () => {
    const current = await loadGuests(accountId);
    await persistGuests(accountId, [guest, ...current]);
  });
  return guest;
}

/** Edits are durable immediately and coalesce into an idempotent server sync. */
export async function updateLocalGuest(
  accountId: string,
  guestId: string,
  fields: { name: string; notes: string },
): Promise<StoredGuest> {
  const updated = await withAccountLock(accountId, async () => {
    const current = await loadGuests(accountId);
    const existing = current.find((guest) => guest.id === guestId);
    if (!existing) throw new Error('guest profile missing');
    const guest: StoredGuest = {
      ...existing,
      name: fields.name.trim(),
      notes: fields.notes,
      updatedAt: Date.now(),
      pendingSync: true,
      localRevision: (existing.localRevision ?? 0) + 1,
    };
    await persistGuests(
      accountId,
      current.map((item) => (item.id === guestId ? guest : item)),
    );
    return guest;
  });
  return updated;
}

/**
 * Ensure the server owns this guest UUID before a recording creates its trial.
 * Concurrent recordings for one guest share a single sync operation.
 */
export function ensureGuestSyncedForAccount(
  accountId: string,
  guestId: string,
): Promise<StoredGuest> {
  const key = `${accountId}:${guestId}`;
  const existing = syncOperations.get(key);
  if (existing) return existing;
  const expectedGeneration = generation;

  const operation = limitedGuestSync(async () => {
    while (true) {
      assertActiveGuestAccount(accountId, expectedGeneration);
      const local = (await loadGuests(accountId)).find((guest) => guest.id === guestId);
      assertActiveGuestAccount(accountId, expectedGeneration);
      if (!local) {
        assertActiveGuestAccount(accountId, expectedGeneration);
        const remote = await fetchRemoteGuest(guestId, accountId);
        assertActiveGuestAccount(accountId, expectedGeneration);
        const stored = withoutPendingSync(remote);
        await withAccountLock(accountId, async () => {
          assertActiveGuestAccount(accountId, expectedGeneration);
          const current = await loadGuests(accountId);
          assertActiveGuestAccount(accountId, expectedGeneration);
          await persistGuests(accountId, [stored, ...current.filter((guest) => guest.id !== guestId)]);
        });
        assertActiveGuestAccount(accountId, expectedGeneration);
        return stored;
      }
      if (!local.pendingSync) return local;

      const sentRevision = local.localRevision ?? 0;
      assertActiveGuestAccount(accountId, expectedGeneration);
      const remote = await createRemoteGuest(local.name, local.notes, local.id, accountId);
      assertActiveGuestAccount(accountId, expectedGeneration);
      let newest!: StoredGuest;
      let changedDuringSync = false;
      await withAccountLock(accountId, async () => {
        assertActiveGuestAccount(accountId, expectedGeneration);
        const current = await loadGuests(accountId);
        assertActiveGuestAccount(accountId, expectedGeneration);
        const latest = current.find((guest) => guest.id === guestId) ?? local;
        changedDuringSync = (latest.localRevision ?? 0) !== sentRevision;
        newest = changedDuringSync
          ? {
              ...latest,
              testCount: remote.testCount,
              lastRecordedAt: remote.lastRecordedAt,
            }
          : withoutPendingSync({
              ...remote,
              localRevision: latest.localRevision,
            });
        await persistGuests(
          accountId,
          current.map((guest) => (guest.id === guestId ? newest : guest)),
        );
      });
      assertActiveGuestAccount(accountId, expectedGeneration);
      if (!changedDuringSync) return newest;
    }
  }).finally(() => {
    if (syncOperations.get(key) === operation) syncOperations.delete(key);
  });
  syncOperations.set(key, operation);
  return operation;
}

export async function syncPendingGuests(accountId: string): Promise<void> {
  const expectedGeneration = generation;
  while (true) {
    assertActiveGuestAccount(accountId, expectedGeneration);
    const pending = (await loadGuests(accountId)).filter((guest) => guest.pendingSync).slice(0, 4);
    assertActiveGuestAccount(accountId, expectedGeneration);
    if (pending.length === 0) return;
    // Only queue one concurrency window at a time. A recording that needs a
    // different guest can enter before the next background batch instead of
    // sitting behind hundreds of low-priority profile writes.
    await Promise.all(pending.map((guest) => ensureGuestSyncedForAccount(accountId, guest.id)));
  }
}

/** Merge cloud truth without discarding guests or edits that exist only locally. */
export async function refreshGuestCache(accountId: string): Promise<StoredGuest[]> {
  const expectedGeneration = generation;
  assertActiveGuestAccount(accountId, expectedGeneration);
  const remote = await fetchRemoteGuests(accountId);
  assertActiveGuestAccount(accountId, expectedGeneration);
  return withAccountLock(accountId, async () => {
    assertActiveGuestAccount(accountId, expectedGeneration);
    const local = await loadGuests(accountId);
    assertActiveGuestAccount(accountId, expectedGeneration);
    const localById = new Map(local.map((guest) => [guest.id, guest]));
    const remoteIds = new Set(remote.map((guest) => guest.id));
    const merged = remote.map<StoredGuest>((guest) => {
      const localGuest = localById.get(guest.id);
      if (!localGuest?.pendingSync) return withoutPendingSync(guest);
      return {
        ...guest,
        ...localGuest,
        testCount: guest.testCount,
        lastRecordedAt: guest.lastRecordedAt,
      };
    });
    // No deletion endpoint exists. Preserve local-only and cached guests even
    // if a stale/read-replica response momentarily omits them.
    merged.push(...local.filter((guest) => !remoteIds.has(guest.id)));
    await persistGuests(accountId, merged);
    assertActiveGuestAccount(accountId, expectedGeneration);
    return sorted(merged);
  });
}

export async function clearAllGuestCaches(): Promise<void> {
  // Invalidate queued/active network work first. Waiting for 100 offline guest
  // syncs here would make logout take minutes; generation checks ensure a late
  // response cannot recreate local state after the purge.
  generation += 1;
  activeGuestAccountId = null;
  syncOperations.clear();
  await Promise.allSettled([...mutationTails.values()]);
  const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
    key.startsWith(STORAGE_KEY_PREFIX) ||
    key.startsWith(CHUNK_STORAGE_KEY_PREFIX) ||
    key.startsWith(ITEM_STORAGE_KEY_PREFIX),
  );
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  caches.clear();
  loadPromises.clear();
  mutationTails.clear();
  listeners.clear();
  syncOperations.clear();
  snapshotGenerations.clear();
}

export function useGuests() {
  const { user } = useUser();
  const accountId = user?.id ?? null;
  const network = useNetworkState();
  const [guests, setGuests] = useState<StoredGuest[]>(
    accountId ? [...(caches.get(accountId) ?? [])] : [],
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    activateGuestAccount(accountId);
    if (!accountId) {
      setGuests([]);
      setLoading(false);
      return undefined;
    }
    const sync = () => {
      if (mounted) setGuests([...(caches.get(accountId) ?? [])]);
    };
    const accountListeners = listeners.get(accountId) ?? new Set<() => void>();
    accountListeners.add(sync);
    listeners.set(accountId, accountListeners);
    setLoading(true);
    void loadGuests(accountId)
      .then(() => {
        if (!mounted) return;
        sync();
        setLoading(false);
        void refreshGuestCache(accountId).catch((error) => {
          recordDiagnostic('guest_refresh_failed', diagnosticErrorData(error));
        });
      })
      .catch((error) => {
        recordDiagnostic('guest_cache_failed', diagnosticErrorData(error));
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      accountListeners.delete(sync);
    };
  }, [accountId]);

  // Any connectivity transition is a useful retry signal. isConnected=false
  // is authoritative; reachability=false alone is not (notably on RU Android).
  useEffect(() => {
    if (!accountId || network.isConnected === false) return;
    void syncPendingGuests(accountId)
      .then(() => refreshGuestCache(accountId))
      .catch((error) => {
        recordDiagnostic('guest_sync_failed', diagnosticErrorData(error));
      });
  }, [accountId, network.isConnected, network.isInternetReachable, network.type]);

  const create = useCallback(
    (name: string, notes: string) => {
      if (!accountId) return Promise.reject(new Error('guest account unavailable'));
      return createLocalGuest(accountId, name, notes);
    },
    [accountId],
  );
  const update = useCallback(
    (guestId: string, fields: { name: string; notes: string }) => {
      if (!accountId) return Promise.reject(new Error('guest account unavailable'));
      return updateLocalGuest(accountId, guestId, fields);
    },
    [accountId],
  );
  const refresh = useCallback(async () => {
    if (!accountId) return;
    await syncPendingGuests(accountId);
    await refreshGuestCache(accountId);
  }, [accountId]);
  const pendingCount = useMemo(
    () => guests.filter((guest) => guest.pendingSync).length,
    [guests],
  );

  return { guests, loading, create, update, refresh, pendingCount };
}

export const __testing = {
  storageKey,
  loadGuests,
  guestItemKey,
  reset() {
    generation += 1;
    activeGuestAccountId = null;
    caches.clear();
    loadPromises.clear();
    mutationTails.clear();
    listeners.clear();
    syncOperations.clear();
    snapshotGenerations.clear();
  },
  persistGuests,
  chunkStoragePrefix,
};
