jest.mock('../api', () => ({ apiFetch: jest.fn() }));

import { apiFetch } from '../api';
import {
  fetchSharedPatients,
  fetchSharedTrialDetail,
  fetchSharedTrials,
  flattenSharedTrials,
  type SharedPatient,
  type SharedTrialsResponse,
} from '../sharedRecordings';

describe('shared recordings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the relationship-gated backend endpoints', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ patients: [] });

    await fetchSharedPatients();
    await fetchSharedTrials('user/with spaces');
    await fetchSharedTrialDetail(42);

    expect(apiFetch).toHaveBeenNthCalledWith(1, '/patients');
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      '/patients/user%2Fwith%20spaces/trials',
    );
    expect(apiFetch).toHaveBeenNthCalledWith(3, '/trials/42');
  });

  it('flattens grouped trials newest-first and preserves pending scores', () => {
    const owner: SharedPatient = {
      patient_id: 'person-1',
      display_name: 'Maya',
      last_recorded_at: '2026-07-16T12:00:00Z',
    };
    const response: SharedTrialsResponse = {
      test_types: [
        {
          id: 'gait',
          display_name: 'Walking',
          updrs_item: 'MDS-UPDRS 3.10',
          unit: 'severity',
          score_min: 0,
          score_max: 1,
          display_order: 1,
        },
      ],
      trials_by_test: {
        gait: [
          { trial_id: 1, recorded_at: '2026-07-15T10:00:00Z', score: 0.25 },
          { trial_id: 2, recorded_at: '2026-07-16T10:00:00Z', score: null },
        ],
      },
    };

    const recordings = flattenSharedTrials(owner, response);

    expect(recordings.map((recording) => recording.trialId)).toEqual([2, 1]);
    expect(recordings[0]).toMatchObject({
      ownerName: 'Maya',
      testName: 'Walking',
      score: null,
    });
    expect(recordings[1].createdAt).toBe(Date.parse('2026-07-15T10:00:00Z'));
  });

  it('keeps unknown server test types visible', () => {
    const recordings = flattenSharedTrials(
      { patient_id: 'person-1', display_name: null, last_recorded_at: null },
      {
        test_types: [],
        trials_by_test: {
          futureTest: [{ trial_id: 7, recorded_at: 'not-a-date', score: 0.5 }],
        },
      },
    );

    expect(recordings[0]).toMatchObject({
      testId: 'futureTest',
      testName: 'futureTest',
      createdAt: 0,
    });
  });
});
