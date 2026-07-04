jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { PollTimeoutError } from '../uploadRetry';

jest.mock('../cloud', () => ({
  uploadRecording: jest.fn(),
  pollResult: jest.fn(),
}));
import { uploadRecording, pollResult } from '../cloud';
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
    (uploadRecording as jest.Mock).mockResolvedValue({ jobId: '99' });
    (pollResult as jest.Mock).mockRejectedValue(new PollTimeoutError());
    const patch = await driveOnce(baseRec(), { maxBackoffs: 0 });
    expect(patch.status).toBe('processing');
    expect(patch.jobId).toBe('99');
  });

  it('server analysis failure → failed, not resumable (manual retry only)', async () => {
    (uploadRecording as jest.Mock).mockResolvedValue({ jobId: '99' });
    (pollResult as jest.Mock).mockRejectedValue(new Error('analysis failed'));
    const patch = await driveOnce(baseRec(), { maxBackoffs: 0 });
    expect(patch.status).toBe('failed');
    expect(patch.resumable).toBe(false);
    expect(patch.permanent).toBe(false);
  });

  it('happy path → done with result', async () => {
    (uploadRecording as jest.Mock).mockResolvedValue({ jobId: '99' });
    (pollResult as jest.Mock).mockResolvedValue({ score: 0.4, label: 'Mild', isDemo: false });
    const patch = await driveOnce(baseRec(), { maxBackoffs: 0 });
    expect(patch.status).toBe('done');
    expect(patch.result?.score).toBe(0.4);
  });
});
