import { PollTimeoutError } from '../uploadRetry';

jest.mock('../api', () => ({
  apiFetch: jest.fn(),
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
});
