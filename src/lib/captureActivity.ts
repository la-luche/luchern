import { AppState } from 'react-native';

let active = false;
let requested = false;
const listeners = new Set<(active: boolean) => void>();

export function isCaptureActive(): boolean {
  return active;
}

export function setCaptureActive(next: boolean): void {
  requested = next;
  updateActivity(AppState.currentState !== 'background' && requested);
}

function updateActivity(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener(active);
}

// A mounted framing screen has no live camera while another app is open.
// Release the pipeline's camera exclusion, then restore it on foregrounding.
AppState.addEventListener('change', state => updateActivity(state !== 'background' && requested));

export function subscribeCaptureActivity(listener: (active: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
