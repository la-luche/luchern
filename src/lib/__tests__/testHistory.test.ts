import { groupTestHistory, testsNewestFirst } from '../testHistory';
import type { Recording } from '../types';
import type { SharedRecording } from '../sharedRecordings';

const clip = (id: string, testId: Recording['testId'], createdAt: number, score?: number): Recording => ({
  id, testId, createdAt, status: score == null ? 'processing' : 'done',
  result: score == null ? undefined : { score, label: '', isDemo: false },
});
it('keeps pending and rejected types accessible, without drawing missing or invalid scores', () => {
  const groups = groupTestHistory([
    clip('walk', 'gait', 1), { ...clip('rejected', 'toeTapping', 2, .5), status: 'needs_retry' },
    clip('zero', 'fingerTapping', 3, 0), clip('invalid', 'fingerTapping', 4, NaN),
    { ...clip('battery', 'arisingFromChair', 5, .75), evaluationRun: { id: 'run', startedAt: 1, expectedSteps: 13 } },
  ]);
  expect(groups.map(g => g.testId)).toEqual(['fingerTapping', 'toeTapping', 'arisingFromChair', 'gait']);
  expect(groups[0].points).toEqual([{ id: 'zero', t: 3, score: 0 }]);
  expect(groups[0].recordings.map(r => r.id)).toEqual(['invalid', 'zero']);
  expect(groups[1].points).toEqual([]);
  expect(groups[2].points).toEqual([{ id: 'battery', t: 5, score: .75 }]);
  expect(groups[3].recordings[0].id).toBe('walk');
});
it('returns every recording newest first including checkup members without mutating the source', () => {
  const records = [clip('old', 'gait', 1), clip('new', 'gait', 8), clip('middle', 'toeTapping', 4), clip('second', 'fingerTapping', 6),
    { ...clip('battery', 'gait', 10), evaluationRun: { id: 'run', startedAt: 10, expectedSteps: 13 } }];
  expect(testsNewestFirst(records).map(r => r.id)).toEqual(['battery', 'new', 'second', 'middle', 'old']);
  expect(records[0].id).toBe('old');
});
it('keeps unknown shared types and excludes rejected shared scores from their charts', () => {
  const base: SharedRecording = { trialId: 1, ownerId: 'p', ownerName: 'Pat', testId: 'futureTest', testName: 'Future test',
    createdAt: 1, score: .25, unit: 'severity', updrsItem: '', scoreable: false, analysisStatus: 'done' };
  const [group] = groupTestHistory([base, { ...base, trialId: 2, createdAt: 2, scoreable: true, score: 0 }]);
  expect(group.testId).toBe('futureTest');
  expect(group.recordings).toHaveLength(2);
  expect(group.points).toEqual([{ id: '2', t: 2, score: 0 }]);
});
