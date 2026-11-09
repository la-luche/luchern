import type { SharedRecording } from './sharedRecordings';
import { compareRecordingAttempts } from './checkupRetakes';
import { FULL_TEST_FLOW } from './tests';
import type { Recording } from './types';

export type CheckupRecording = Recording | SharedRecording;
export type ScoreAverage = { value: number | null; count: number };
export type Checkup<T extends CheckupRecording = CheckupRecording> = {
  id: string;
  startedAt: number;
  expectedSteps: number;
  recordings: T[];
  overall: ScoreAverage;
  left: ScoreAverage;
  right: ScoreAverage;
  walking: ScoreAverage;
  standing: ScoreAverage;
};

/** Use the same 0–4 displayed level as individual results, never a missing result as zero. */
export function availableGrade(recording: CheckupRecording): number | null {
  let grade: number | undefined | null;
  let score: number | undefined | null;
  if ('trialId' in recording) {
    if (recording.scoreable === false || (recording.analysisStatus != null && recording.analysisStatus !== 'done')) return null;
    grade = recording.updrsGrade;
    score = recording.score;
  } else {
    if (recording.status !== 'done') return null;
    grade = recording.result?.updrsGrade;
    score = recording.result?.score;
  }
  if (grade != null) return Number.isFinite(grade) && grade >= 0 && grade <= 4 ? grade : null;
  return score != null && Number.isFinite(score) && score >= 0 && score <= 1 ? score * 4 : null;
}

export function averageScores(recordings: CheckupRecording[]): ScoreAverage {
  const grades = recordings.map(availableGrade).filter((grade): grade is number => grade !== null);
  return { value: grades.length ? grades.reduce((sum, grade) => sum + grade, 0) / grades.length : null, count: grades.length };
}

function stepKey(recording: { testId: string; evaluatedSide?: string }) {
  return `${recording.testId}:${recording.evaluatedSide ?? ''}`;
}
const stepOrder = new Map(FULL_TEST_FLOW.map((step, index) => [stepKey(step), index]));

/** Only explicit run IDs group recordings. Legacy individual tests stay individual. */
export function groupCheckups<T extends CheckupRecording>(recordings: T[]): Checkup<T>[] {
  const groups = new Map<string, T[]>();
  for (const recording of recordings) {
    if (!recording.evaluationRun?.id) continue;
    const scope = 'trialId' in recording ? `shared:${recording.ownerId}` : `owned:${recording.guestId ?? 'me'}`;
    const key = `${scope}:${recording.evaluationRun.id}`;
    groups.set(key, [...(groups.get(key) ?? []), recording]);
  }
  return [...groups.values()].map((group) => {
    // Retakes replace a step; they must never add a second vote to the average.
    const latest = new Map<string, T>();
    for (const recording of [...group].sort((a, b) => {
      const aDraft = 'status' in a && a.status === 'draft';
      const bDraft = 'status' in b && b.status === 'draft';
      return Number(bDraft) - Number(aDraft) || compareRecordingAttempts(
        { createdAt: a.createdAt, id: 'trialId' in a ? String(a.trialId) : a.id },
        { createdAt: b.createdAt, id: 'trialId' in b ? String(b.trialId) : b.id },
      );
    })) latest.set(stepKey(recording), recording);
    const ordered = [...latest.values()].sort((a, b) => (stepOrder.get(stepKey(a)) ?? 100) - (stepOrder.get(stepKey(b)) ?? 100) || a.createdAt - b.createdAt);
    const run = group[0].evaluationRun!;
    return {
      id: run.id,
      startedAt: run.startedAt,
      expectedSteps: Math.max(run.expectedSteps, ordered.length),
      recordings: ordered,
      overall: averageScores(ordered),
      left: averageScores(ordered.filter((recording) => recording.evaluatedSide === 'left')),
      right: averageScores(ordered.filter((recording) => recording.evaluatedSide === 'right')),
      walking: averageScores(ordered.filter((recording) => recording.testId === 'gait')),
      standing: averageScores(ordered.filter((recording) => recording.testId === 'arisingFromChair')),
    };
  }).sort((a, b) => b.startedAt - a.startedAt);
}

export function formatCheckupScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

/** One point per scored checkup, using exactly the overall value shown in its summary. */
export function checkupTrendPoints(checkups: Checkup[]) {
  return checkups.flatMap((checkup) => {
    const score = checkup.overall.value;
    if (score === null || !Number.isFinite(score) || !Number.isFinite(checkup.startedAt)) return [];
    return [{ id: checkup.id, t: checkup.startedAt, score }];
  }).sort((a, b) => a.t - b.t);
}
