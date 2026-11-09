import type { Recording } from './types';

function stepScope(recording: Recording): string {
  return JSON.stringify([recording.guestId ?? null, recording.evaluationRun?.id, recording.testId, recording.evaluatedSide ?? null]);
}

/** Match the server's ordering even when offline clips upload out of order. */
export function compareRecordingAttempts(a: Pick<Recording, 'createdAt' | 'id'>, b: Pick<Recording, 'createdAt' | 'id'>): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** A completed, committed replacement makes older attempts standalone; never delete their work. */
export function supersedeCheckupRetakes(recordings: Recording[]): Recording[] {
  const latest = new Map<string, Recording>();
  for (const recording of recordings) {
    if (!recording.evaluationRun || recording.supersededEvaluationRun || recording.status === 'draft') continue;
    const key = stepScope(recording);
    const previous = latest.get(key);
    if (!previous || compareRecordingAttempts(recording, previous) > 0) latest.set(key, recording);
  }
  return recordings.map((recording) => {
    if (!recording.evaluationRun) return recording;
    const replacement = latest.get(stepScope(recording));
    if (!recording.supersededEvaluationRun && (!replacement || compareRecordingAttempts(replacement, recording) <= 0)) return recording;
    return {
      ...recording,
      supersededEvaluationRun: recording.supersededEvaluationRun ?? recording.evaluationRun,
      evaluationRun: undefined,
      localRevision: (recording.localRevision ?? 0) + 1,
    };
  });
}
