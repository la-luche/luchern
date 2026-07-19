jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../modules/face-blur', () => ({
  addProgressListener: jest.fn(),
  blurVideoAsync: jest.fn(),
  cancelAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../recordingFiles', () => ({
  faceBlurFileUris: jest.fn(() => ({
    pendingUri: 'file:///recordings/r1.pending.mp4',
    finalUri: 'file:///recordings/r1.face-blurred.mp4',
  })),
  promoteFaceBlurredFile: jest.fn().mockResolvedValue('file:///recordings/r1.face-blurred.mp4'),
}));

import * as FileSystem from 'expo-file-system/legacy';

import {
  addProgressListener,
  blurVideoAsync,
  cancelAsync,
} from '../../../modules/face-blur';
import { FaceBlurCancelledError, prepareFaceBlurredVideo } from '../faceBlur';
import { promoteFaceBlurredFile } from '../recordingFiles';

describe('face blur preparation', () => {
  const remove = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (FileSystem.getInfoAsync as jest.Mock).mockReset();
    (blurVideoAsync as jest.Mock).mockReset();
    (addProgressListener as jest.Mock).mockReturnValue({ remove });
    (FileSystem.getInfoAsync as jest.Mock)
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, size: 100 });
    (blurVideoAsync as jest.Mock).mockResolvedValue({
      outputUri: 'file:///recordings/r1.pending.mp4',
      framesProcessed: 20,
      framesWithFaces: 18,
      detections: 18,
    });
  });

  it('promotes the native output and leaves original deletion to storage', async () => {
    const progress: number[] = [];
    const result = await prepareFaceBlurredVideo(
      'r1',
      'file:///recordings/r1.original.mov',
      (value) => progress.push(value),
    );

    expect(blurVideoAsync).toHaveBeenCalledWith(
      'file:///recordings/r1.original.mov',
      'file:///recordings/r1.pending.mp4',
      'face-blur:r1',
    );
    expect(promoteFaceBlurredFile).toHaveBeenCalled();
    expect(FileSystem.deleteAsync).not.toHaveBeenCalledWith(
      'file:///recordings/r1.original.mov',
      expect.anything(),
    );
    expect(result).toMatchObject({
      videoUri: 'file:///recordings/r1.face-blurred.mp4',
      framesProcessed: 20,
      recovered: false,
    });
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('recovers a promoted sanitized file without running the encoder again', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockReset();
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({
      exists: true,
      size: 100,
    });
    const progress: number[] = [];

    const result = await prepareFaceBlurredVideo(
      'r1',
      'file:///recordings/r1.original.mov',
      (value) => progress.push(value),
    );

    expect(blurVideoAsync).not.toHaveBeenCalled();
    expect(promoteFaceBlurredFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      videoUri: 'file:///recordings/r1.face-blurred.mp4',
      recovered: true,
    });
    expect(progress).toEqual([1]);
  });

  it('fails closed when the native detector finds no faces', async () => {
    (blurVideoAsync as jest.Mock).mockResolvedValueOnce({
      outputUri: 'file:///recordings/r1.pending.mp4',
      framesProcessed: 48,
      framesWithFaces: 0,
      detections: 0,
    });

    await expect(
      prepareFaceBlurredVideo('r1', 'file:///recordings/r1.original.mov', () => {}),
    ).rejects.toThrow('no face could be detected');

    expect(promoteFaceBlurredFile).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///recordings/r1.pending.mp4',
      { idempotent: true },
    );
  });

  it('cancels native processing when the recording operation aborts', async () => {
    const controller = new AbortController();
    let rejectNative!: (error: Error) => void;
    (blurVideoAsync as jest.Mock).mockImplementation(
      () => new Promise((_, reject) => {
        rejectNative = reject;
      }),
    );
    const result = prepareFaceBlurredVideo(
      'r1',
      'file:///recordings/r1.original.mov',
      () => {},
      controller.signal,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(blurVideoAsync).toHaveBeenCalled();
    controller.abort();
    rejectNative(new Error('cancelled'));

    await expect(result).rejects.toBeInstanceOf(FaceBlurCancelledError);
    expect(cancelAsync).toHaveBeenCalledWith('face-blur:r1');
  });
});
