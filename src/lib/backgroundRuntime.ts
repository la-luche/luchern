import { AppState } from 'react-native';
import { backgroundWork, type BackgroundMode } from '../../modules/background-work';
import { diagnosticErrorData, recordDiagnostic } from './diagnostics';

let session: { id: string; start: Promise<BackgroundMode> } | undefined;
let generation = 0;
let paused = false;
let copy = { title: 'Preparing your results', subtitle: 'Processing your tests' };
let mode: BackgroundMode = 'unavailable';
const listeners = new Set<() => void>();
const expiredListeners = new Set<() => void>();
const tickListeners = new Set<() => void>();

function emit() { listeners.forEach(listener => listener()); }
export function setBackgroundCopy(title: string, subtitle: string) { copy = { title, subtitle }; }
export function getBackgroundMode() { return mode; }
export function subscribeBackgroundMode(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function onBackgroundExpiration(listener: () => void) { expiredListeners.add(listener); }
export function onBackgroundTick(listener: () => void) { tickListeners.add(listener); }
export function isBackgroundWorkPaused() { return paused; }
export function allowBackgroundWork() { paused = false; }

export function ensureBackgroundWork(): Promise<BackgroundMode> {
  if (session) return session.start;
  if (paused || AppState.currentState === 'background') return Promise.resolve('unavailable');
  const id = `work-${Date.now()}-${++generation}`;
  const start = (backgroundWork?.beginAsync(id, copy.title, copy.subtitle) ?? Promise.resolve('unavailable' as const))
    .catch(error => {
      recordDiagnostic('background_work_unavailable', diagnosticErrorData(error));
      return 'unavailable' as const;
    }).then(value => {
      if (session?.id === id) {
        mode = value;
        if (value === 'unavailable') {
          session = undefined;
          void backgroundWork?.endAsync(id, false).catch(() => {});
        }
        emit();
      }
      return value;
    });
  session = { id, start };
  return start;
}

export function updateBackgroundWork(progress: number, subtitle: string): void {
  if (!session) return;
  void backgroundWork?.updateAsync(session.id, copy.title, subtitle || copy.subtitle, progress)
    .catch(error => recordDiagnostic('background_progress_failed', diagnosticErrorData(error)));
}

export function endBackgroundWork(success = true): void {
  const current = session;
  session = undefined;
  mode = 'unavailable';
  emit();
  if (current) void backgroundWork?.endAsync(current.id, success).catch(() => {});
}

backgroundWork?.addListener('onExpired', event => {
  if (event.sessionId !== session?.id) return;
  paused = true;
  endBackgroundWork(false);
  expiredListeners.forEach(listener => listener());
});
backgroundWork?.addListener('onTick', event => {
  if (event.sessionId === session?.id) tickListeners.forEach(listener => listener());
});
backgroundWork?.addListener('onModeChanged', event => {
  if (event.sessionId !== session?.id) return;
  mode = event.mode;
  session.start = Promise.resolve(mode);
  emit();
});
