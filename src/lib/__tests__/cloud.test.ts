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
import { pollResult } from '../cloud';

describe('pollResult', () => {
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
