import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HistoryPerson, HistorySection } from './personFlow';

export type HistorySelection = { person: HistoryPerson; section: HistorySection };
const selections = new Map<string, HistorySelection>();
const writes = new Map<string, Promise<void>>();
const key = (accountId: string) => `luche:history-selection:${accountId}`;
const defaultSelection = (): HistorySelection => ({ person: { kind: 'me' }, section: 'checkups' });

export async function readHistorySelection(accountId?: string): Promise<HistorySelection> {
  if (!accountId) return defaultSelection();
  const cached = selections.get(accountId);
  if (cached) return cached;
  try {
    const value = JSON.parse(await AsyncStorage.getItem(key(accountId)) ?? 'null');
    if (value && (value.section === 'tests' || value.section === 'checkups') &&
      (value.person?.kind === 'me' || (['guest', 'shared'].includes(value.person?.kind) && typeof value.person.id === 'string' && value.person.id))) {
      const selection = { person: value.person, section: value.section } as HistorySelection;
      // A selection made while storage was loading wins over the older disk copy.
      if (!selections.has(accountId)) selections.set(accountId, selection);
    }
  } catch { /* A missing/corrupt preference must not block opening history. */ }
  return selections.get(accountId) ?? defaultSelection();
}

export async function rememberHistorySelection(accountId: string | undefined, selection: HistorySelection) {
  if (!accountId) return;
  selections.set(accountId, selection);
  // Navigation stays available if disk persistence fails; memory still remembers it.
  const write = (writes.get(accountId) ?? Promise.resolve())
    .then(() => AsyncStorage.setItem(key(accountId), JSON.stringify(selection)))
    .catch(() => {});
  writes.set(accountId, write);
  await write;
  if (writes.get(accountId) === write) writes.delete(accountId);
}
