import { useSyncExternalStore } from 'react';
import { randomUUID } from 'expo-crypto';

import type { FullTestStep } from './tests';
import type { EvaluationRunRef } from './types';

/**
 * Guided "run all" session: walk the patient through an ordered list of tests
 * back-to-back. A tiny module-level store (no context/provider needed) so the
 * instruction, capture, and menu screens can all read/advance it. Individual
 * test taps from the menu clear the session so they run as one-offs.
 */
type SessionState = {
  active: boolean;
  steps: readonly FullTestStep[];
  index: number;
  run: EvaluationRunRef | null;
};

let state: SessionState = { active: false, steps: [], index: 0, run: null };
const listeners = new Set<() => void>();

function set(next: SessionState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Begin a session over the given ordered test/side steps, starting at the first. */
export function startSession(steps: readonly FullTestStep[]) {
  set({
    active: true,
    steps,
    index: 0,
    run: { id: randomUUID(), startedAt: Date.now(), expectedSteps: steps.length },
  });
}

export function endSession() {
  if (!state.active) return;
  set({ active: false, steps: [], index: 0, run: null });
}

/**
 * Advance to the next test/side step, or return null if the session is
 * finished (the caller should then endSession() and leave the flow).
 */
export function advanceSession(): FullTestStep | null {
  if (!state.active) return null;
  const nextIndex = state.index + 1;
  if (nextIndex >= state.steps.length) return null;
  set({ ...state, index: nextIndex });
  return state.steps[nextIndex] ?? null;
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
  /** The test/side step the session is currently on, or null when inactive. */
  current: FullTestStep | null;
  /** 1-based position for display. */
  position: number;
  total: number;
}

export function useSession(): SessionView {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...s,
    current: s.active ? (s.steps[s.index] ?? null) : null,
    position: s.index + 1,
    total: s.steps.length,
  };
}
