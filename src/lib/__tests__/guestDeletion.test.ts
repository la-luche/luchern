jest.mock('../api', () => ({ apiFetch: jest.fn() }));
jest.mock('../guestDeletionState', () => ({ markGuestDeleted: jest.fn(), loadDeletedGuests: jest.fn().mockResolvedValue(new Set()) }));
jest.mock('../guestStorage', () => ({ ensureGuestSyncedForAccount: jest.fn(), removeDeletedGuestLocally: jest.fn() }));
jest.mock('../storage', () => ({ guestRecordingsForDeletion: jest.fn(), pauseGuestRecordings: jest.fn(), purgeGuestRecordings: jest.fn() }));

import { apiFetch } from '../api';
import { markGuestDeleted } from '../guestDeletionState';
import { removeDeletedGuestLocally } from '../guestStorage';
import { guestRecordingsForDeletion, pauseGuestRecordings, purgeGuestRecordings } from '../storage';
import { prepareGuestDeletion, deleteGuestWithRecordings, GuestHistoryChangedError } from '../guestDeletion';
const release = jest.fn();
const remote = { recording_keys: ['client:uploaded', 'client:remote'], trials: [{ id: '10', client_id: 'uploaded' }, { id: '11', client_id: 'remote' }] };
const local = [{ id: 'uploaded', jobId: '10', guestId: 'g' }, { id: 'offline', guestId: 'g' }];
beforeEach(() => {
  jest.clearAllMocks();
  (apiFetch as jest.Mock).mockReset().mockResolvedValue(remote);
  (guestRecordingsForDeletion as jest.Mock).mockResolvedValue(local);
  (pauseGuestRecordings as jest.Mock).mockResolvedValue(release);
});
it('counts the union of local and cloud tests without counting an uploaded recording twice', async () => {
  const preview = await prepareGuestDeletion('account', 'g');
  expect(preview.testCount).toBe(3);
  expect(preview.keys).toEqual(['client:offline', 'client:remote', 'client:uploaded']);
  expect(markGuestDeleted).not.toHaveBeenCalled();
});
it('deletes only the confirmed account and guest, then clears originals and the profile', async () => {
  const preview = await prepareGuestDeletion('account', 'g');
  await deleteGuestWithRecordings(preview);
  expect(apiFetch).toHaveBeenLastCalledWith('/guests/g', {
    method: 'DELETE', body: JSON.stringify({ recording_keys: preview.keys, upload_ids: [] }),
  }, 'account');
  expect(markGuestDeleted).toHaveBeenCalledWith('account', 'g');
  expect(purgeGuestRecordings).toHaveBeenCalledWith('account', 'g');
  expect(removeDeletedGuestLocally).toHaveBeenCalledWith('account', 'g');
  expect(release).toHaveBeenCalled();
});
it('keeps local files and profile when the server cannot finish deleting', async () => {
  const preview = await prepareGuestDeletion('account', 'g');
  (apiFetch as jest.Mock).mockResolvedValueOnce(remote).mockRejectedValueOnce(new Error('offline'));
  await expect(deleteGuestWithRecordings(preview)).rejects.toThrow('offline');
  expect(markGuestDeleted).not.toHaveBeenCalled();
  expect(purgeGuestRecordings).not.toHaveBeenCalled();
  expect(removeDeletedGuestLocally).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalled();
});
it('requires a fresh count when recordings change during confirmation', async () => {
  const preview = await prepareGuestDeletion('account', 'g');
  (apiFetch as jest.Mock).mockResolvedValue({ ...remote, recording_keys: [...remote.recording_keys, 'client:new'] });
  await expect(deleteGuestWithRecordings(preview)).rejects.toBeInstanceOf(GuestHistoryChangedError);
  expect(markGuestDeleted).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalled();
});
