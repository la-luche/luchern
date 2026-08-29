let active = false;
const listeners = new Set<(active: boolean) => void>();

export function isCaptureActive(): boolean {
  return active;
}

export function setCaptureActive(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener(active);
}

export function subscribeCaptureActivity(listener: (active: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
