import { endSession, startSession } from './session';
import { FULL_TEST_FLOW } from './tests';

export type PersonPickerMode = 'single' | 'full' | 'history';
export type HistorySection = 'tests' | 'checkups';
export type HistoryPerson =
  | { kind: 'me' }
  | { kind: 'guest'; id: string }
  | { kind: 'shared'; id: string };

export function personPickerMode(value: unknown): PersonPickerMode | null {
  return value === 'single' || value === 'full' || value === 'history' ? value : null;
}

/** Start the selected flow only after its recording subject is known. */
export function beginPersonTest(mode: 'single' | 'full', guestId?: string) {
  if (mode === 'full') {
    startSession(FULL_TEST_FLOW);
    return { pathname: '/prepare' as const, params: { mode: 'full', guestId: guestId ?? '' } };
  }
  endSession();
  return { pathname: '/tests' as const, params: { guestId: guestId ?? '' } };
}

export function historyPerson(guestId?: string, patientId?: string): HistoryPerson {
  if (guestId) return { kind: 'guest', id: guestId };
  if (patientId) return { kind: 'shared', id: patientId };
  return { kind: 'me' };
}

export function personHistoryHref(person: HistoryPerson, section: HistorySection = 'tests') {
  return {
    pathname: '/results' as const,
    // Explicitly clear the other scope when reusing an existing history route.
    params: {
      guestId: person.kind === 'guest' ? person.id : '',
      patientId: person.kind === 'shared' ? person.id : '',
      section,
    },
  };
}

export function checkupHref(id: string, person: HistoryPerson) {
  return { pathname: '/checkups/[id]' as const, params: {
    id,
    guestId: person.kind === 'guest' ? person.id : '',
    patientId: person.kind === 'shared' ? person.id : '',
  } };
}

export function historyRecordingHref(recording: { id: string; guestId?: string }) {
  return {
    pathname: '/results/[id]' as const,
    params: { id: recording.id, guestId: recording.guestId ?? '', fromHistory: '1' },
  };
}

export function testHistoryHref(testId: string, person: HistoryPerson) {
  return { pathname: '/results/test/[testId]' as const, params: {
    testId,
    guestId: person.kind === 'guest' ? person.id : '',
    patientId: person.kind === 'shared' ? person.id : '',
  } };
}
