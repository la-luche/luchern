jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../diagnostics', () => ({
  recordDiagnostic: jest.fn(),
  diagnosticErrorData: (error: Error) => ({ error: error.name, message: error.message }),
}));
jest.mock('../api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number) {
      super(`HTTP ${status}`);
      this.status = status;
    }
  },
}));

import { PollTimeoutError, UPLOAD_BACKOFFS_MS } from '../uploadRetry';

jest.mock('../cloud', () => ({
  AnalysisNeedsRetryError: class AnalysisNeedsRetryError extends Error {
    reasons: string[];
    constructor(reasons: string[]) {
      super(`analysis returned no score: ${reasons.join(', ')}`);
      this.reasons = reasons;
    }
  },
  UploadIntentExpiredError: class UploadIntentExpiredError extends Error {},
  uploadRecording: jest.fn(),
  createAnalysisTrial: jest.fn(),
  deleteRemoteRecording: jest.fn(),
  deleteRemoteUpload: jest.fn(),
  pollResult: jest.fn(),
}));
import { AnalysisNeedsRetryError, createAnalysisTrial, pollResult, uploadRecording } from '../cloud';
import { __testing } from '../storage';

const { driveOnce } = __testing;

const baseRec = () => ({
  id: 'r1',
  testId: 'gait' as const,
  createdAt: 0,
  videoUri: 'file:///clip.mp4',
  status: 'uploading' as const,
});

describe('driveOnce', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retryable upload error → failed + resumable', async () => {
    (uploadRecording as jest.Mock).mockRejectedValue(new Error('upload failed (403)'));
    const rec = baseRec();
    const patch = await driveOnce(rec, { maxBackoffs: 0 });
    expect(patch.status).toBe('failed');
    expect(patch.resumable).toBe(true);
    expect(patch.permanent).toBe(false);
    expect(patch.failReason).toContain('403');
  });

  it('permanent upload error → failed, not resumable, not permanent-retryable', async () => {
    (uploadRecording as jest.Mock).mockRejectedValue(new Error('recording file missing'));
    const patch = await driveOnce(baseRec(), { maxBackoffs: 0 });
    expect(patch.status).toBe('failed');
    expect(patch.permanent).toBe(true);
    expect(patch.resumable).toBe(false);
  });

  it('poll timeout → stays processing (NOT failed)', async () => {
    (uploadRecording as jest.Mock).mockResolvedValue({ uploadId: 'up-1' });
    (createAnalysisTrial as jest.Mock).mockResolvedValue({ jobId: '99' });
    (pollResult as jest.Mock).mockRejectedValue(new PollTimeoutError());
    const patch = await driveOnce(baseRec(), { maxBackoffs: 0 });
    expect(patch.status).toBe('processing');
    expect(patch.jobId).toBe('99');
  });

  it('server analysis failure → failed, not resumable (manual retry only)', async () => {
    (uploadRecording as jest.Mock).mockResolvedValue({ uploadId: 'up-1' });
    (createAnalysisTrial as jest.Mock).mockResolvedValue({ jobId: '99' });
    (pollResult as jest.Mock).mockRejectedValue(new Error('analysis failed'));
    const patch = await driveOnce(baseRec(), { maxBackoffs: 0 });
    expect(patch.status).toBe('failed');
    expect(patch.resumable).toBe(false);
    expect(patch.permanent).toBe(false);
  });

  it('server no-score result → terminal needs_retry with quality reasons', async () => {
    (uploadRecording as jest.Mock).mockResolvedValue({ uploadId: 'up-1' });
    (createAnalysisTrial as jest.Mock).mockResolvedValue({ jobId: '99' });
    (pollResult as jest.Mock).mockRejectedValue(
      new AnalysisNeedsRetryError(['tracking_gap', 'insufficient_repetitions']),
    );

    const patch = await driveOnce(baseRec(), { maxBackoffs: 0 });

    expect(patch).toMatchObject({
      status: 'needs_retry',
      jobId: '99',
      analysisFailureReasons: ['tracking_gap', 'insufficient_repetitions'],
      resumable: false,
    });
  });

  it('happy path → done with result', async () => {
    (uploadRecording as jest.Mock).mockResolvedValue({ uploadId: 'up-1' });
    (createAnalysisTrial as jest.Mock).mockResolvedValue({ jobId: '99' });
    (pollResult as jest.Mock).mockResolvedValue({ score: 0.4, label: 'Mild', isDemo: false });
    const patch = await driveOnce(baseRec(), { maxBackoffs: 0 });
    expect(patch.status).toBe('done');
    expect(patch.result?.score).toBe(0.4);
  });

  it('resumed processing record re-polls without re-uploading', async () => {
    (pollResult as jest.Mock).mockResolvedValue({ score: 0.4, label: 'Mild', isDemo: false });
    const rec = { ...baseRec(), status: 'processing' as const, jobId: '99' };
    const patch = await driveOnce(rec, { maxBackoffs: 0 });
    expect(uploadRecording).not.toHaveBeenCalled();
    expect(pollResult).toHaveBeenCalledWith('99', 'gait');
    expect(patch.status).toBe('done');
  });

  it('persists the upload id and job id at their crash-safe boundaries', async () => {
    (uploadRecording as jest.Mock).mockResolvedValue({ uploadId: 'up-1' });
    (createAnalysisTrial as jest.Mock).mockResolvedValue({ jobId: '99' });
    (pollResult as jest.Mock).mockResolvedValue({ score: 0.4, label: 'Mild', isDemo: false });
    const seen: string[] = [];
    const patch = await driveOnce(baseRec(), {
      maxBackoffs: 0,
      onBytesUploaded: (uploadId) => { seen.push(`upload:${uploadId}`); },
      onTrialCreated: (jobId) => { seen.push(`trial:${jobId}`); },
    });
    expect(seen).toEqual(['upload:up-1', 'trial:99']);
    expect(patch.status).toBe('done');
  });

  it('resumes trial submission from uploadId without resending video bytes', async () => {
    (createAnalysisTrial as jest.Mock).mockResolvedValue({ jobId: '99' });
    (pollResult as jest.Mock).mockResolvedValue({ score: 0.4, label: 'Mild', isDemo: false });
    const rec = { ...baseRec(), status: 'processing' as const, uploadId: 'up-1' };
    const patch = await driveOnce(rec, { maxBackoffs: 0 });
    expect(uploadRecording).not.toHaveBeenCalled();
    expect(createAnalysisTrial).toHaveBeenCalledWith('up-1', 'gait', 'r1', 0);
    expect(patch.status).toBe('done');
  });

  it('keeps uploadId when the small trial request fails', async () => {
    (createAnalysisTrial as jest.Mock).mockRejectedValue(new Error('network down'));
    const rec = { ...baseRec(), status: 'processing' as const, uploadId: 'up-1' };
    const patch = await driveOnce(rec, { maxBackoffs: 0 });
    expect(uploadRecording).not.toHaveBeenCalled();
    expect(patch).toMatchObject({
      status: 'failed',
      uploadId: 'up-1',
      resumable: true,
    });
  });

  it('reports the failed backoff and the currently running retry attempt', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    (uploadRecording as jest.Mock)
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ uploadId: 'up-1' });
    (createAnalysisTrial as jest.Mock).mockResolvedValue({ jobId: '99' });
    (pollResult as jest.Mock).mockResolvedValue({ score: 0.4, label: 'Mild', isDemo: false });
    const attempts: number[] = [];
    const retries: number[] = [];
    const result = driveOnce(baseRec(), {
      maxBackoffs: 1,
      onUploadAttempt: (attempt) => attempts.push(attempt),
      onUploadRetry: (attempt) => retries.push(attempt),
    });
    await jest.advanceTimersByTimeAsync(UPLOAD_BACKOFFS_MS[0]);
    await expect(result).resolves.toMatchObject({ status: 'done' });
    expect(attempts).toEqual([1, 2]);
    expect(retries).toEqual([2]);
  });
});
