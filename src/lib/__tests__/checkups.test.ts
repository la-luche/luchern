import { availableGrade, checkupTrendPoints, groupCheckups } from '../checkups';
import { flattenSharedTrials } from '../sharedRecordings';
import type { Recording } from '../types';

jest.mock('../api', () => ({ apiFetch: jest.fn() }));
const run = { id: 'run', startedAt: 1, expectedSteps: 13 };
function clip(id: string, testId: Recording['testId'], grade?: number, evaluatedSide?: 'left' | 'right'): Recording {
  return { id, testId, status: grade == null ? 'processing' : 'done', createdAt: 1, evaluatedSide,
    evaluationRun: run, result: grade == null ? undefined : { score: grade / 4, updrsGrade: grade, label: '', isDemo: false } };
}
it('averages all available results equally and computes side/walking/standing subscores', () => {
  const [checkup] = groupCheckups([
    clip('l1', 'fingerTapping', 0, 'left'), clip('l2', 'toeTapping', 2, 'left'),
    clip('r', 'fingerTapping', 4, 'right'), clip('w', 'gait', 3), clip('s', 'arisingFromChair', 1),
    clip('tremor', 'restTremor', 2), clip('pending', 'handMovements', undefined, 'left'),
    { ...clip('failed', 'legAgility', 4, 'right'), status: 'needs_retry' },
  ]);
  expect(checkup.overall).toEqual({ value: 2, count: 6 });
  expect(checkup.left).toEqual({ value: 1, count: 2 });
  expect(checkup.right).toEqual({ value: 4, count: 1 });
  expect(checkup.walking.value).toBe(3);
  expect(checkup.standing.value).toBe(1);
  expect(checkup.expectedSteps).toBe(13);
});
it('does not invent a zero when no score exists or let invalid numbers enter an average', () => {
  expect(groupCheckups([clip('pending', 'gait')])[0].overall).toEqual({ value: null, count: 0 });
  for (const grade of [NaN, Infinity, -1, 5]) expect(availableGrade(clip('bad', 'gait', grade))).toBeNull();
  const fallback = clip('legacy', 'gait', 1);
  delete fallback.result!.updrsGrade;
  expect(availableGrade(fallback)).toBe(1);
});
it('keeps people and runs separate, ignores standalone tests, and uses the newest retake per step', () => {
  const recordings = [clip('old', 'gait', 4), { ...clip('new', 'gait', 1), createdAt: 2 },
    { ...clip('guest', 'gait', 3), guestId: 'guest-1' },
    { ...clip('single', 'gait', 4), evaluationRun: undefined },
    { ...clip('another', 'gait', 2), evaluationRun: { ...run, id: 'another-run', startedAt: 3 } }];
  const groups = groupCheckups(recordings);
  expect(groups).toHaveLength(3);
  expect(groups[0].id).toBe('another-run');
  expect(groups.find(g => g.recordings[0].id === 'new')?.overall.value).toBe(1);
  expect(groups.flatMap(g => g.recordings.map(r => r.id))).not.toContain('old');
  expect(groups.flatMap(g => g.recordings.map(r => r.id))).not.toContain('single');
});
it('keeps the accepted result until a replacement has been accepted', () => {
  const accepted = clip('old', 'gait', 2);
  const replacement = { ...clip('new', 'gait'), status: 'draft' as const, createdAt: 2 };
  expect(groupCheckups([replacement, accepted])[0].recordings.map(r => r.id)).toEqual(['old']);
  expect(groupCheckups([{ ...replacement, status: 'preparing' }, accepted])[0].recordings.map(r => r.id)).toEqual(['new']);
});
it('preserves shared checkup metadata and excludes a rejected score', () => {
  const recordings = flattenSharedTrials({ patient_id: 'p', display_name: 'Pat', last_recorded_at: null }, {
    test_types: [], trials_by_test: {
      fingerTapping: [{ trial_id: 1, recorded_at: '2026-11-03T12:00:00Z', score: .5, updrs_grade: 2,
        evaluated_side: 'left', evaluation_run_id: 'r', evaluation_run_expected_steps: 13, analysis_status: 'done' }],
      gait: [{ trial_id: 2, recorded_at: '2026-11-03T12:01:00Z', score: .75, scoreable: false,
        evaluation_run_id: 'r', analysis_status: 'done' }],
    },
  });
  const [checkup] = groupCheckups(recordings);
  expect(checkup.overall).toEqual({ value: 2, count: 1 });
  expect(checkup.left.value).toBe(2);
  expect(checkup.walking.value).toBeNull();
});
it('plots one overall score per checkup, keeps zero, and skips unscored checkups', () => {
  const groups = groupCheckups([
    clip('left', 'fingerTapping', 1, 'left'), clip('right', 'fingerTapping', 3, 'right'),
    { ...clip('zero', 'gait', 0), evaluationRun: { ...run, id: 'zero-run', startedAt: 0 } },
    { ...clip('pending', 'gait'), evaluationRun: { ...run, id: 'pending-run', startedAt: 2 } },
    { ...clip('single', 'gait', 4), evaluationRun: undefined },
  ]);
  expect(checkupTrendPoints(groups)).toEqual([
    { id: 'zero-run', t: 0, score: 0 }, { id: 'run', t: 1, score: 2 },
  ]);
});
