import { apiFetch } from './api';

interface GuestPayload {
  guest_id: string;
  name: string;
  notes: string;
  test_count: number;
  last_recorded_at: string | null;
  created_at: string;
  updated_at: string;
}

interface GuestsResponse {
  guests: GuestPayload[];
}

export interface Guest {
  id: string;
  name: string;
  notes: string;
  testCount: number;
  lastRecordedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function guest(payload: GuestPayload): Guest {
  return {
    id: payload.guest_id,
    name: payload.name,
    notes: payload.notes,
    testCount: payload.test_count,
    lastRecordedAt: timestamp(payload.last_recorded_at),
    createdAt: timestamp(payload.created_at) ?? Date.now(),
    updatedAt: timestamp(payload.updated_at) ?? Date.now(),
  };
}

export async function fetchGuests(expectedAccountId?: string): Promise<Guest[]> {
  const response = await apiFetch<GuestsResponse>('/guests', {}, expectedAccountId);
  return response.guests.map(guest);
}

export async function fetchGuest(guestId: string, expectedAccountId?: string): Promise<Guest> {
  const response = await apiFetch<GuestPayload>(
    `/guests/${encodeURIComponent(guestId)}`,
    {},
    expectedAccountId,
  );
  return guest(response);
}

export async function createGuest(
  name: string,
  notes: string,
  guestId?: string,
  expectedAccountId?: string,
): Promise<Guest> {
  const response = await apiFetch<GuestPayload>('/guests', {
    method: 'POST',
    body: JSON.stringify({ name, notes, ...(guestId ? { guest_id: guestId } : {}) }),
  }, expectedAccountId);
  return guest(response);
}

export async function updateGuest(
  guestId: string,
  fields: { name: string; notes: string },
): Promise<Guest> {
  const response = await apiFetch<GuestPayload>(`/guests/${encodeURIComponent(guestId)}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
  return guest(response);
}
