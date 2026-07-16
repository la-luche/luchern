import { useSyncExternalStore } from 'react';

import type { TestId } from './tests';

/**
 * Guided "run all" session: walk the patient through an ordered list of tests
 * back-to-back. A tiny module-level store (no context/provider needed) so the
 * instruction, capture, and menu screens can all read/advance it. Individual
 * test taps from the menu clear the session so they run as one-offs.
 */
type SessionState = {
  active: boolean;
  testIds: readonly TestId[];
  index: number;
};

let state: SessionState = { active: false, testIds: [], index: 0 };
const listeners = new Set<() => void>();

function set(next: SessionState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Begin a session over the given ordered tests, starting at the first. */
export function startSession(testIds: readonly TestId[]) {
  set({ active: true, testIds, index: 0 });
}

export function endSession() {
  if (!state.active) return;
  set({ active: false, testIds: [], index: 0 });
}

/**
 * Advance to the next test. Returns the next TestId, or null if the session is
 * finished (the caller should then endSession() and leave the flow).
 */
export function advanceSession(): TestId | null {
  if (!state.active) return null;
  const nextIndex = state.index + 1;
  if (nextIndex >= state.testIds.length) return null;
  set({ ...state, index: nextIndex });
  return state.testIds[nextIndex] ?? null;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return state;
}

export interface SessionView extends SessionState {
  /** The test the session is currently on, or null when inactive. */
  current: TestId | null;
  /** 1-based position for display. */
  position: number;
  total: number;
}

export function useSession(): SessionView {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...s,
    current: s.active ? (s.testIds[s.index] ?? null) : null,
    position: s.index + 1,
    total: s.testIds.length,
  };
}
