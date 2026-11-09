import { apiFetch } from './api';
import { loadDeletedGuests, markGuestDeleted } from './guestDeletionState';
import { ensureGuestSyncedForAccount, removeDeletedGuestLocally } from './guestStorage';
import { guestRecordingsForDeletion, pauseGuestRecordings, purgeGuestRecordings } from './storage';
import type { Recording } from './types';

type RemoteSnapshot = {
  recording_keys: string[];
  trials: { id: string; client_id: string }[];
  deleted?: boolean;
};
export type GuestDeletionPreview = {
  accountId: string;
  guestId: string;
  keys: string[];
  testCount: number;
};
export class GuestHistoryChangedError extends Error {}

export function deletionRecordingKeys(local: Recording[], remote: RemoteSnapshot): string[] {
  const byId = new Map(remote.trials.map(trial => [trial.id, trial]));
  const keys = new Set(remote.recording_keys);
  for (const recording of local) {
    const trial = recording.jobId ? byId.get(recording.jobId) : undefined;
    keys.add(trial ? trial.client_id ? `client:${trial.client_id}` : `trial:${trial.id}` : `client:${recording.id}`);
  }
  return [...keys].sort();
}

export async function prepareGuestDeletion(accountId: string, guestId: string): Promise<GuestDeletionPreview> {
  if (!(await loadDeletedGuests(accountId)).has(guestId)) {
    try { await ensureGuestSyncedForAccount(accountId, guestId); }
    catch (error) { if (!(await loadDeletedGuests(accountId)).has(guestId)) throw error; }
  }
  const remote = await apiFetch<RemoteSnapshot>(`/guests/${encodeURIComponent(guestId)}/deletion`, {}, accountId);
  const local = await guestRecordingsForDeletion(accountId, guestId);
  const keys = deletionRecordingKeys(local, remote);
  return { accountId, guestId, keys, testCount: keys.length };
}

export async function deleteGuestWithRecordings(preview: GuestDeletionPreview): Promise<void> {
  const { accountId, guestId } = preview;
  const release = await pauseGuestRecordings(accountId, guestId);
  try {
    const remote = await apiFetch<RemoteSnapshot>(`/guests/${encodeURIComponent(guestId)}/deletion`, {}, accountId);
    const local = await guestRecordingsForDeletion(accountId, guestId);
    const keys = deletionRecordingKeys(local, remote);
    // If another device added or removed a recording while the warning was
    // open, show the new count and ask the user to confirm it again.
    if (!remote.deleted && JSON.stringify(keys) !== JSON.stringify(preview.keys)) throw new GuestHistoryChangedError();
    await apiFetch(`/guests/${encodeURIComponent(guestId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ recording_keys: preview.keys, upload_ids: local.flatMap(r => r.uploadId ? [r.uploadId] : []) }),
    }, accountId);
    await markGuestDeleted(accountId, guestId);
    await purgeGuestRecordings(accountId, guestId);
    await removeDeletedGuestLocally(accountId, guestId);
  } finally { release(); }
}
