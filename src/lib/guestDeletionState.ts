import AsyncStorage from '@react-native-async-storage/async-storage';

const prefix = 'luche.deleted-guests.v1.';
const deleted = new Map<string, Set<string>>();
const loads = new Map<string, Promise<Set<string>>>();
const writes = new Map<string, Promise<void>>();
const listeners = new Set<(accountId: string, guestId: string) => void>();

export function deletedGuestIds(accountId: string): ReadonlySet<string> {
  return deleted.get(accountId) ?? new Set();
}

export function loadDeletedGuests(accountId: string): Promise<Set<string>> {
  if (deleted.has(accountId)) return Promise.resolve(deleted.get(accountId)!);
  const existing = loads.get(accountId);
  if (existing) return existing;
  const load = AsyncStorage.getItem(prefix + accountId).then(raw => {
    const ids: unknown = JSON.parse(raw ?? '[]');
    const result = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
    deleted.set(accountId, result);
    return result;
  }).finally(() => loads.delete(accountId));
  loads.set(accountId, load);
  return load;
}

/** Persist explicit server deletion before touching local originals or metadata. */
export function markGuestDeleted(accountId: string, guestId: string): Promise<void> {
  const write = (writes.get(accountId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const ids = await loadDeletedGuests(accountId);
    if (ids.has(guestId)) return;
    const next = new Set([...ids, guestId]);
    await AsyncStorage.setItem(prefix + accountId, JSON.stringify([...next]));
    deleted.set(accountId, next);
    for (const listener of listeners) listener(accountId, guestId);
  });
  writes.set(accountId, write);
  return write;
}

export function subscribeGuestDeletion(listener: (accountId: string, guestId: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function clearGuestDeletionState() {
  await Promise.allSettled([...writes.values()]);
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
  await AsyncStorage.multiRemove(keys);
  deleted.clear(); loads.clear(); writes.clear();
}
