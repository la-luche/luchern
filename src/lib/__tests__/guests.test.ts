jest.mock('../api', () => ({ apiFetch: jest.fn() }));

import { apiFetch } from '../api';
import { createGuest, fetchGuest, fetchGuests, updateGuest } from '../guests';

const payload = {
  guest_id: 'guest-1',
  name: 'Maria',
  notes: 'Uses a walking aid',
  test_count: 3,
  last_recorded_at: '2026-08-24T10:00:00Z',
  created_at: '2026-08-20T10:00:00Z',
  updated_at: '2026-08-24T10:00:00Z',
};

describe('guest API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps the synced guest list into app-shaped records', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ guests: [payload] });

    await expect(fetchGuests()).resolves.toEqual([
      expect.objectContaining({
        id: 'guest-1',
        name: 'Maria',
        notes: 'Uses a walking aid',
        testCount: 3,
      }),
    ]);
    expect(apiFetch).toHaveBeenCalledWith('/guests');
  });

  it('uses owner-private guest endpoints for create, read, and inline edit', async () => {
    (apiFetch as jest.Mock).mockResolvedValue(payload);

    await createGuest('Maria', 'Uses a walking aid');
    expect(apiFetch).toHaveBeenLastCalledWith('/guests', {
      method: 'POST',
      body: JSON.stringify({ name: 'Maria', notes: 'Uses a walking aid' }),
    });

    await fetchGuest('guest-1');
    expect(apiFetch).toHaveBeenLastCalledWith('/guests/guest-1');

    await updateGuest('guest-1', { name: 'Maria S.', notes: 'Updated' });
    expect(apiFetch).toHaveBeenLastCalledWith('/guests/guest-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Maria S.', notes: 'Updated' }),
    });
  });
});
