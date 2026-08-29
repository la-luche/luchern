jest.mock('@clerk/clerk-expo', () => ({ useUser: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '0198f04d-58ad-7c08-b1ac-67a40b046be7'),
}));
jest.mock('expo-network', () => ({ useNetworkState: jest.fn(() => ({})) }));
jest.mock('../diagnostics', () => ({
  recordDiagnostic: jest.fn(),
  diagnosticErrorData: (error: Error) => ({ error: error.name, message: error.message }),
}));
jest.mock('../guests', () => ({
  createGuest: jest.fn(),
  fetchGuest: jest.fn(),
  fetchGuests: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __testing,
  activateGuestAccount,
  createLocalGuest,
  ensureGuestSyncedForAccount,
  refreshGuestCache,
  updateLocalGuest,
} from '../guestStorage';
import { createGuest, fetchGuests } from '../guests';

const accountId = 'user-event';
const guestId = '0198f04d-58ad-7c08-b1ac-67a40b046be7';
const remoteGuest = (overrides = {}) => ({
  id: guestId,
  name: 'Guest one',
  notes: '',
  testCount: 0,
  lastRecordedAt: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

async function flushBackgroundSync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('offline-first guest storage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    __testing.reset();
    activateGuestAccount(accountId);
    await AsyncStorage.clear();
  });

  it('creates and reloads a usable guest while the API is offline', async () => {
    (createGuest as jest.Mock).mockRejectedValue(new Error('network request failed'));

    const created = await createLocalGuest(accountId, ' Guest one ', 'event');
    await flushBackgroundSync();
    expect(created).toMatchObject({
      id: guestId,
      name: 'Guest one',
      notes: 'event',
      pendingSync: true,
    });

    __testing.reset();
    await expect(__testing.loadGuests(accountId)).resolves.toEqual([
      expect.objectContaining({ id: guestId, pendingSync: true }),
    ]);
  });

  it('uses the device UUID to idempotently sync before trial submission', async () => {
    await AsyncStorage.setItem(
      __testing.storageKey(accountId),
      JSON.stringify([{ ...remoteGuest(), pendingSync: true, localRevision: 1 }]),
    );
    (createGuest as jest.Mock).mockResolvedValue(remoteGuest({ updatedAt: 2_000 }));

    const synced = await ensureGuestSyncedForAccount(accountId, guestId);

    expect(createGuest).toHaveBeenCalledWith('Guest one', '', guestId, accountId);
    expect(synced.pendingSync).toBeUndefined();
    expect((await __testing.loadGuests(accountId))[0]?.pendingSync).toBeUndefined();
  });

  it('keeps offline edits when a cloud refresh arrives', async () => {
    (createGuest as jest.Mock).mockRejectedValue(new Error('network request failed'));
    await AsyncStorage.setItem(
      __testing.storageKey(accountId),
      JSON.stringify([remoteGuest()]),
    );
    await updateLocalGuest(accountId, guestId, { name: 'Edited locally', notes: 'new note' });
    await flushBackgroundSync();
    (fetchGuests as jest.Mock).mockResolvedValue([
      remoteGuest({ name: 'Old cloud name', testCount: 4 }),
    ]);

    const refreshed = await refreshGuestCache(accountId);

    expect(refreshed[0]).toMatchObject({
      name: 'Edited locally',
      notes: 'new note',
      testCount: 4,
      pendingSync: true,
    });
  });

  it('does not persist a late sync response after the signed-in account changes', async () => {
    let resolveRemote!: (value: ReturnType<typeof remoteGuest>) => void;
    (createGuest as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveRemote = resolve; }),
    );
    await AsyncStorage.setItem(
      __testing.storageKey(accountId),
      JSON.stringify([{ ...remoteGuest(), pendingSync: true, localRevision: 1 }]),
    );

    const syncing = ensureGuestSyncedForAccount(accountId, guestId);
    await flushBackgroundSync();
    activateGuestAccount('user-other');
    resolveRemote(remoteGuest({ updatedAt: 2_000 }));

    await expect(syncing).rejects.toThrow('guest sync cancelled');
    __testing.reset();
    const stored = await __testing.loadGuests(accountId);
    expect(stored[0]?.pendingSync).toBe(true);
  });

  it('round-trips 1,200 maximal multibyte profiles as bounded A/B records', async () => {
    const guests = Array.from({ length: 1200 }, (_, index) => ({
      ...remoteGuest({
        id: `guest-${index}`,
        name: '名'.repeat(120),
        notes: '記'.repeat(2000),
      }),
      id: `guest-${index}`,
      pendingSync: true,
      localRevision: 1,
    }));

    await __testing.persistGuests(accountId, guests);
    const itemKeys = (await AsyncStorage.getAllKeys()).filter((key) =>
      key.includes('luche.guests.v3.'),
    );
    expect(itemKeys).toHaveLength(2400);
    for (const [, value] of await AsyncStorage.multiGet(itemKeys)) {
      expect(value?.length ?? 0).toBeLessThan(16 * 1024);
    }

    __testing.reset();
    activateGuestAccount(accountId);
    await expect(__testing.loadGuests(accountId)).resolves.toHaveLength(1200);
  });

  it('falls back to the previous guest generation after a torn newest row', async () => {
    const first = [{ ...remoteGuest({ name: 'first' }), pendingSync: true, localRevision: 1 }];
    const second = [{ ...first[0], name: 'second', localRevision: 2 }];
    await __testing.persistGuests(accountId, first);
    await __testing.persistGuests(accountId, second);
    await AsyncStorage.setItem(__testing.guestItemKey(accountId, guestId, 0), '{torn');

    __testing.reset();
    activateGuestAccount(accountId);

    await expect(__testing.loadGuests(accountId)).resolves.toEqual([
      expect.objectContaining({ id: guestId, name: 'first' }),
    ]);
  });
});
