jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getFreeDiskStorageAsync: jest.fn().mockResolvedValue(10 * 1024 * 1024 * 1024),
  readAsStringAsync: jest.fn().mockRejectedValue(new Error('no completion marker')),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../modules/face-blur', () => ({
  addProgressListener: jest.fn(),
  blurVideoAsync: jest.fn(),
  cancelAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../recordingFiles', () => ({
  privacyBlurFileUris: jest.fn(() => ({
    pendingUri: 'file:///recordings/r1.pending.mp4',
    finalUri: 'file:///recordings/r1.privacy-blurred.mp4',
    completionUri: 'file:///recordings/r1.privacy-blurred.complete.json',
  })),
  promotePrivacyBlurredFile: jest.fn().mockResolvedValue('file:///recordings/r1.privacy-blurred.mp4'),
}));

import * as FileSystem from 'expo-file-system/legacy';

import {
  addProgressListener,
  blurVideoAsync,
  cancelAsync,
} from '../../../modules/face-blur';
import { FaceBlurCancelledError, prepareFaceBlurredVideo } from '../faceBlur';
import { promotePrivacyBlurredFile } from '../recordingFiles';

describe('privacy blur preparation', () => {
  const remove = jest.fn();
  const options = {
    blurFaces: true,
    blurBackground: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (FileSystem.getInfoAsync as jest.Mock).mockReset();
    (blurVideoAsync as jest.Mock).mockReset();
    (addProgressListener as jest.Mock).mockReturnValue({ remove });
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 100 });
    (FileSystem.readAsStringAsync as jest.Mock).mockRejectedValue(new Error('no completion marker'));
    (blurVideoAsync as jest.Mock).mockResolvedValue({
      outputUri: 'file:///recordings/r1.pending.mp4',
      framesProcessed: 20,
      framesWithFaces: 18,
      framesWithBackgroundBlur: 20,
      poseSamples: 4,
      totalPoseSamples: 20,
      faceSamples: 18,
      detectorMode: 'rtmdet_nano_rtmpose_t_coco17_dense',
    });
  });

  it('promotes the native output without deleting the original', async () => {
    const progress: number[] = [];
    const result = await prepareFaceBlurredVideo(
      'r1',
      'file:///recordings/r1.original.mov',
      options,
      (value) => progress.push(value),
    );

    expect(blurVideoAsync).toHaveBeenCalledWith(
      'file:///recordings/r1.original.mov',
      'file:///recordings/r1.pending.mp4',
      'face-blur:r1',
      options,
    );
    expect(promotePrivacyBlurredFile).toHaveBeenCalled();
    expect(FileSystem.deleteAsync).not.toHaveBeenCalledWith(
      'file:///recordings/r1.original.mov',
      expect.anything(),
    );
    expect(result).toMatchObject({
      videoUri: 'file:///recordings/r1.privacy-blurred.mp4',
      framesProcessed: 20,
      recovered: false,
    });
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('recovers a promoted sanitized file without running the encoder again', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockReset();
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 100,
    });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify({ size: 100 }));
    const progress: number[] = [];

    const result = await prepareFaceBlurredVideo(
      'r1',
      'file:///recordings/r1.original.mov',
      options,
      (value) => progress.push(value),
    );

    expect(blurVideoAsync).not.toHaveBeenCalled();
    expect(promotePrivacyBlurredFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      videoUri: 'file:///recordings/r1.privacy-blurred.mp4',
      recovered: true,
    });
    expect(progress).toEqual([1]);
  });

  it('regenerates a nonempty final whose completion marker does not match', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 100 });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify({ size: 99 }));

    const result = await prepareFaceBlurredVideo(
      'r1',
      'file:///recordings/r1.original.mov',
      options,
      () => {},
    );

    expect(blurVideoAsync).toHaveBeenCalled();
    expect(result.recovered).toBe(false);
  });

  it('fails closed when on-device pose estimation finds no person', async () => {
    (blurVideoAsync as jest.Mock).mockResolvedValueOnce({
      outputUri: 'file:///recordings/r1.pending.mp4',
      framesProcessed: 48,
      framesWithFaces: 0,
      framesWithBackgroundBlur: 0,
      poseSamples: 0,
    });

    await expect(
      prepareFaceBlurredVideo('r1', 'file:///recordings/r1.original.mov', options, () => {}),
    ).rejects.toThrow('no person pose could be detected');

    expect(promotePrivacyBlurredFile).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///recordings/r1.pending.mp4',
      { idempotent: true },
    );
  });

  it('does not require a face region when only background blur was selected', async () => {
    (blurVideoAsync as jest.Mock).mockResolvedValueOnce({
      outputUri: 'file:///recordings/r1.pending.mp4',
      framesProcessed: 20,
      framesWithFaces: 0,
      framesWithBackgroundBlur: 20,
      poseSamples: 4,
    });

    await expect(
      prepareFaceBlurredVideo(
        'r1',
        'file:///recordings/r1.original.mov',
        { ...options, blurFaces: false },
        () => {},
      ),
    ).resolves.toMatchObject({ framesWithFaces: 0, recovered: false });
  });

  it('does not require background output when only face blur was selected', async () => {
    (blurVideoAsync as jest.Mock).mockResolvedValueOnce({
      outputUri: 'file:///recordings/r1.pending.mp4',
      framesProcessed: 20,
      framesWithFaces: 18,
      framesWithBackgroundBlur: 0,
      poseSamples: 4,
    });

    await expect(
      prepareFaceBlurredVideo(
        'r1',
        'file:///recordings/r1.original.mov',
        { ...options, blurBackground: false },
        () => {},
      ),
    ).resolves.toMatchObject({ framesWithBackgroundBlur: 0, recovered: false });
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
      options,
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
