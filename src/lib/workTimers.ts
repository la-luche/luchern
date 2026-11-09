import { backgroundWork } from '../../modules/background-work';

type TimerHandle = ReturnType<typeof setTimeout>;
const pending = new Map<TimerHandle, { deadline: number; run: () => void }>();

/** RN suspends JS timers when its activity is hidden. Native lease ticks keep
 * retry backoffs, privacy watchdogs, and result polling advancing nonetheless. */
export function setWorkTimeout(callback: () => void, ms: number): TimerHandle {
  const run = () => {
    if (!pending.delete(handle)) return;
    clearTimeout(handle);
    callback();
  };
  const handle = setTimeout(run, ms);
  pending.set(handle, { deadline: Date.now() + ms, run });
  return handle;
}

export function clearWorkTimeout(handle: TimerHandle): void {
  pending.delete(handle);
  clearTimeout(handle);
}

export function flushWorkTimers(now = Date.now()): void {
  for (const task of [...pending.values()]) {
    if (task.deadline <= now) task.run();
  }
}

backgroundWork?.addListener('onTick', () => flushWorkTimers());
