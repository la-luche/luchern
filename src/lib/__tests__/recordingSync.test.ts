jest.mock('../api', () => ({ apiFetch: jest.fn() }));

import {
  LOCAL_VIDEO_RETENTION_MS,
  mergeOwnedTrials,
  mergeTrialScope,
  type OwnedTrialSummary,
} from '../recordingSync';
import type { Recording } from '../types';

const now = Date.parse('2026-07-17T12:00:00Z');

it('does not resurrect a superseded checkup clip from a stale server response', () => {
  const run = { id: 'run', startedAt: 1, expectedSteps: 13 };
  const previous = local({ supersededEvaluationRun: run });
  const merged = mergeOwnedTrials([previous], [trial({ evaluation_run_id: 'run' })], now);
  expect(merged.recordings[0].evaluationRun).toBeUndefined();
  expect(merged.recordings[0].supersededEvaluationRun).toEqual(run);
  expect(merged.recordings[0].result?.score).toBe(.4);
});
it('honors a server detachment made by a replacement on another device', () => {
  const run = { id: 'run', startedAt: 1, expectedSteps: 13 };
  const merged = mergeOwnedTrials([local({ evaluationRun: run })], [trial({ evaluation_run_id: null })], now);
  expect(merged.recordings[0].evaluationRun).toBeUndefined();
  expect(merged.recordings[0].supersededEvaluationRun).toEqual(run);
});

function trial(overrides: Partial<OwnedTrialSummary> = {}): OwnedTrialSummary {
  return {
    trial_id: 42,
    client_trial_id: 'local-42',
    test_type_id: 'gait',
    recorded_at: new Date(now - 60_000).toISOString(),
    score: 0.4,
    updrs_grade: 1.5,
    updrs_label: 'Slight',
    analysis_status: 'done',
    analysis_error: null,
    scoreable: true,
    is_estimate: true,
    confidence: 'low',
    evaluated_side: null,
    quality_failures: [],
    ...overrides,
  };
}

function local(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'local-42',
    testId: 'gait',
    createdAt: now - 60_000,
    videoUri: 'file:///documents/recordings/local-42.mp4',
    status: 'processing',
    jobId: '42',
    ...overrides,
  };
}

describe('mergeOwnedTrials', () => {
  it('keeps imported videos without analysis out of the processing queue', () => {
    const existing = local({ originalVideoUri: 'file:///original.mov' });
    const merged = mergeOwnedTrials([existing], [trial({
      analysis_status: null, score: null, updrs_grade: null, scoreable: null,
    })], now);

    expect(merged.recordings[0]).toMatchObject({
      status: 'unscored', jobId: '42', videoUri: existing.videoUri,
      originalVideoUri: 'file:///original.mov',
    });
    expect(merged.recordings[0].result).toBeUndefined();
    expect(merged.localUrisToDelete).toEqual([]);
  });

  it.each(['queued', 'running'])('continues processing a real %s analysis job', (status) => {
    const merged = mergeOwnedTrials([], [trial({ analysis_status: status, score: null })], now);
    expect(merged.recordings[0].status).toBe('processing');
  });

  it('hydrates server recordings that were created on another device', () => {
    const merged = mergeOwnedTrials([], [trial()], now);

    expect(merged.recordings[0]).toMatchObject({
      id: 'local-42',
      jobId: '42',
      status: 'done',
      result: { score: 0.4, updrsGrade: 1.5 },
    });
    expect(merged.recordings[0].videoUri).toBeUndefined();
  });

  it('tags guest history returned by the guest-scoped sync endpoint', () => {
    const merged = mergeOwnedTrials([], [trial()], now, 'guest-42');

    expect(merged.recordings[0]).toMatchObject({
      id: 'local-42',
      guestId: 'guest-42',
      jobId: '42',
    });
  });

  it('keeps uploaded clips locally for three days', () => {
    const merged = mergeOwnedTrials([local()], [trial()], now);

    expect(merged.recordings[0].videoUri).toBe(local().videoUri);
    expect(merged.localUrisToDelete).toEqual([]);
  });

  it('evicts a classified sanitized clip once its three-day retention has elapsed', () => {
    const recordedAt = now - LOCAL_VIDEO_RETENTION_MS - 1;
    const existing = local({
      createdAt: recordedAt,
      videoUri: 'file:///documents/recordings/local-42.privacy-blurred.mp4',
      originalVideoUri: 'file:///documents/recordings/local-42.mov',
      privacyBlurState: 'completed',
    });
    const merged = mergeOwnedTrials(
      [existing],
      [trial({ recorded_at: new Date(recordedAt).toISOString() })],
      now,
    );

    expect(merged.recordings[0].videoUri).toBeUndefined();
    expect(merged.localUrisToDelete).toEqual([existing.videoUri]);
  });

  it('never auto-deletes an unclassified legacy upload that may be the original', () => {
    const recordedAt = now - LOCAL_VIDEO_RETENTION_MS - 1;
    const existing = local({ createdAt: recordedAt, privacyBlurState: undefined });
    const merged = mergeOwnedTrials(
      [existing],
      [trial({ recorded_at: new Date(recordedAt).toISOString() })],
      now,
    );

    expect(merged.recordings[0].originalVideoUri).toBe(existing.videoUri);
    expect(merged.localUrisToDelete).toEqual([]);
  });

  it('never auto-evicts the never-uploaded original after de-identification', () => {
    const recordedAt = now - LOCAL_VIDEO_RETENTION_MS - 1;
    const existing = local({
      createdAt: recordedAt,
      videoUri: 'file:///documents/recordings/local-42.privacy-blurred.mp4',
      originalVideoUri: 'file:///documents/recordings/local-42.mov',
      privacyBlurState: 'completed',
    });
    const merged = mergeOwnedTrials(
      [existing],
      [trial({ recorded_at: new Date(recordedAt).toISOString() })],
      now,
    );

    expect(merged.recordings[0].videoUri).toBeUndefined();
    expect(merged.recordings[0].originalVideoUri).toBe(existing.originalVideoUri);
    expect(merged.localUrisToDelete).toEqual([existing.videoUri]);
  });

  it('never evicts a local-only recording even when it is old', () => {
    const pending = local({
      id: 'pending',
      jobId: undefined,
      status: 'failed',
      resumable: true,
      createdAt: now - 10 * LOCAL_VIDEO_RETENTION_MS,
    });
    const merged = mergeOwnedTrials([pending], [], now);

    expect(merged.recordings).toEqual([pending]);
    expect(merged.localUrisToDelete).toEqual([]);
  });

  it('retains every local video in a 100-recording offline queue', () => {
    const pending = Array.from({ length: 100 }, (_, index) =>
      local({
        id: `pending-${index}`,
        jobId: undefined,
        uploadId: index % 2 === 0 ? `upload-${index}` : undefined,
        status: 'failed',
        resumable: true,
        createdAt: now - 10 * LOCAL_VIDEO_RETENTION_MS,
        videoUri: `file:///documents/recordings/pending-${index}.mp4`,
      }),
    );

    const merged = mergeOwnedTrials(pending, [], now);

    expect(merged.recordings).toHaveLength(100);
    expect(merged.recordings.map((recording) => recording.videoUri)).toEqual(
      expect.arrayContaining(pending.map((recording) => recording.videoUri)),
    );
    expect(merged.localUrisToDelete).toEqual([]);
  });

  it('never treats absence from a list response as permission to delete local files', () => {
    const existing = local({
      videoUri: 'file:///documents/recordings/local-42.privacy-blurred.mp4',
      originalVideoUri: 'file:///documents/recordings/local-42.mov',
    });
    const merged = mergeOwnedTrials([existing], [], now);

    expect(merged.recordings).toEqual([existing]);
    expect(merged.localUrisToDelete).toEqual([]);
  });
});

describe('mergeTrialScope', () => {
  const personal = local({ id: 'personal', jobId: '10' });
  const guest = local({ id: 'guest', jobId: '20', guestId: 'guest-1' });

  it('does not remove guest history while refreshing personal history', () => {
    const merged = mergeTrialScope(
      [personal, guest],
      [trial({ trial_id: 10, client_trial_id: 'personal' })],
      undefined,
      now,
    );

    expect(merged.recordings.map((recording) => recording.id).sort()).toEqual([
      'guest',
      'personal',
    ]);
    expect(merged.recordings.find((recording) => recording.id === 'guest')?.guestId).toBe(
      'guest-1',
    );
  });

  it('does not remove personal history while refreshing one guest', () => {
    const merged = mergeTrialScope(
      [personal, guest],
      [trial({ trial_id: 20, client_trial_id: 'guest' })],
      'guest-1',
      now,
    );

    expect(merged.recordings.map((recording) => recording.id).sort()).toEqual([
      'guest',
      'personal',
    ]);
    expect(merged.recordings.find((recording) => recording.id === 'personal')?.guestId).toBeUndefined();
  });
});
