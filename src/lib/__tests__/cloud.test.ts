import { PollTimeoutError } from '../uploadRetry';

jest.mock('../api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number) {
      super(`HTTP ${status}`);
      this.status = status;
    }
  },
  apiFetch: jest.fn(),
}));
jest.mock('../diagnostics', () => ({
  recordDiagnostic: jest.fn(),
  diagnosticErrorData: (error: Error) => ({ error: error.name, message: error.message }),
}));
import { apiFetch } from '../api';
import { AnalysisNeedsRetryError, createAnalysisTrial, pollResult } from '../cloud';

describe('createAnalysisTrial', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the anatomical side selected before recording', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ trial_id: 165 });

    await createAnalysisTrial('upload-1', 'handMovements', 'local-1', 0, 'left');

    expect(apiFetch).toHaveBeenCalledWith('/trials', {
      method: 'POST',
      body: JSON.stringify({
        upload_id: 'upload-1',
        test_type_id: 'handMovements',
        recorded_at: '1970-01-01T00:00:00.000Z',
        metadata: { evaluated_side: 'left' },
        client_trial_id: 'local-1',
        analyze: true,
      }),
    }, undefined);
  });

  it('sends an owner-private guest id when the recording belongs to a guest', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ trial_id: 201 });

    await createAnalysisTrial(
      'upload-guest',
      'gait',
      'local-guest',
      0,
      undefined,
      'guest-201',
    );

    expect(apiFetch).toHaveBeenCalledWith('/trials', {
      method: 'POST',
      body: JSON.stringify({
        upload_id: 'upload-guest',
        test_type_id: 'gait',
        recorded_at: '1970-01-01T00:00:00.000Z',
        metadata: {},
        client_trial_id: 'local-guest',
        guest_id: 'guest-201',
        analyze: true,
      }),
    }, undefined);
  });

  it('links every guided recording to its offline-created evaluation run', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ trial_id: 313 });

    await createAnalysisTrial(
      'upload-battery',
      'restTremor',
      'local-battery',
      1_787_828_400_000,
      undefined,
      undefined,
      {
        id: '76387c90-1234-4a7f-8dee-908a1f238c88',
        startedAt: 1_787_828_100_000,
        expectedSteps: 13,
      },
    );

    expect(apiFetch).toHaveBeenCalledWith('/trials', {
      method: 'POST',
      body: JSON.stringify({
        upload_id: 'upload-battery',
        test_type_id: 'restTremor',
        recorded_at: '2026-08-27T11:00:00.000Z',
        metadata: {},
        client_trial_id: 'local-battery',
        evaluation_run_id: '76387c90-1234-4a7f-8dee-908a1f238c88',
        evaluation_run_started_at: '2026-08-27T10:55:00.000Z',
        evaluation_run_expected_steps: 13,
        analyze: true,
      }),
    }, undefined);
  });
});

describe('pollResult', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it('throws PollTimeoutError when the ceiling passes with no result', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ analysis_status: 'processing', score: null });
    jest.useFakeTimers();
    const p = pollResult('42', 'gait');
    // Attach the rejection assertion before advancing timers so the rejection
    // (which lands mid-advance) is never briefly unhandled — jest/node flags
    // that as a test failure even when the assertion itself would pass.
    const assertion = expect(p).rejects.toBeInstanceOf(PollTimeoutError);
    // advance past the 30-min ceiling
    await jest.advanceTimersByTimeAsync(31 * 60 * 1000);
    await assertion;
  });

  it('throws a plain analysis-failed error when the server fails the trial', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ analysis_status: 'failed', score: null });
    await expect(pollResult('42', 'gait')).rejects.toThrow('analysis failed');
    await expect(pollResult('42', 'gait')).rejects.not.toBeInstanceOf(PollTimeoutError);
  });

  it('stops polling and preserves the backend reasons when no score is possible', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({
      analysis_status: 'needs_retry',
      score: null,
      scoreable: false,
      submetrics: { quality_failures: ['tracking_gap', 'insufficient_repetitions'] },
    });

    const error = await pollResult('42', 'gait').catch((reason) => reason);

    expect(error).toBeInstanceOf(AnalysisNeedsRetryError);
    expect(error.reasons).toEqual(['tracking_gap', 'insufficient_repetitions']);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('uses a readable fallback reason when a quality rejection has no details', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({
      analysis_status: 'done',
      score: null,
      scoreable: false,
      submetrics: {},
    });

    const error = await pollResult('42', 'gait').catch((reason) => reason);

    expect(error).toBeInstanceOf(AnalysisNeedsRetryError);
    expect(error.reasons).toEqual(['insufficient_capture_quality']);
  });

  it('keeps polling through a transient error, then resolves on success', async () => {
    (apiFetch as jest.Mock)
      .mockRejectedValueOnce(new Error('GET /trials/41300 → 503 unavailable'))
      .mockResolvedValueOnce({ analysis_status: 'done', score: 0.4, updrs_label: 'Mild' });
    jest.useFakeTimers();
    const p = pollResult('41300', 'gait');
    const assertion = expect(p).resolves.toMatchObject({ score: 0.4 });
    await jest.advanceTimersByTimeAsync(5000); // past one POLL_INTERVAL_MS (3000)
    await assertion;
  });
});
