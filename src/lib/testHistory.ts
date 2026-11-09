import type { TrendPoint } from '../components/TrendChart';
import type { SharedRecording } from './sharedRecordings';
import { TESTS } from './tests';
import type { Recording } from './types';

export type TestHistoryRecording = Recording | SharedRecording;
export type TestHistoryGroup<T extends TestHistoryRecording = TestHistoryRecording> = {
  testId: string;
  recordings: T[];
  points: TrendPoint[];
};
const order = new Map<string, number>(TESTS.map((test, index) => [test.id, index]));

export function testsNewestFirst<T extends TestHistoryRecording>(recordings: T[]): T[] {
  return [...recordings].sort((a, b) => b.createdAt - a.createdAt);
}

/** Group every recording by test type, including checkup members and pending results. */
export function groupTestHistory<T extends TestHistoryRecording>(recordings: T[]): TestHistoryGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const recording of recordings) {
    const group = groups.get(recording.testId) ?? [];
    group.push(recording);
    groups.set(recording.testId, group);
  }
  return [...groups.entries()].map(([testId, matches]) => ({
    testId,
    recordings: testsNewestFirst(matches),
    points: testTrendPoints(matches),
  })).sort((a, b) => (order.get(a.testId) ?? 100) - (order.get(b.testId) ?? 100) || a.testId.localeCompare(b.testId));
}

/** Only valid completed scores become dots; zero is a real result. */
export function testTrendPoints(recordings: TestHistoryRecording[]): TrendPoint[] {
  return recordings.flatMap((recording) => {
    const shared = 'trialId' in recording;
    if (shared) {
      if (recording.scoreable === false || (recording.analysisStatus != null && recording.analysisStatus !== 'done')) return [];
    } else if (recording.status !== 'done') return [];
    const score = shared ? recording.score : recording.result?.score;
    if (score == null || !Number.isFinite(score) || score < 0 || score > 1 || !Number.isFinite(recording.createdAt)) return [];
    return [{ id: shared ? String(recording.trialId) : recording.id, t: recording.createdAt, score }];
  }).sort((a, b) => a.t - b.t);
}
