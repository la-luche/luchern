import * as FileSystem from 'expo-file-system/legacy';

import {
  addProgressListener,
  blurVideoAsync,
  cancelAsync,
  type FaceBlurResult,
  type PrivacyBlurOptions,
} from '../../modules/face-blur';
import {
  privacyBlurFileUris,
  promotePrivacyBlurredFile,
} from './recordingFiles';

export class FaceBlurCancelledError extends Error {
  constructor() {
    super('face blurring cancelled');
    this.name = 'FaceBlurCancelledError';
  }
}

export type PreparedFaceBlur = FaceBlurResult & {
  videoUri: string;
  recovered: boolean;
};

async function hasUsableFile(uri: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(uri);
  return Boolean(info.exists && 'size' in info && typeof info.size === 'number' && info.size > 0);
}

async function hasCompletedOutput(finalUri: string, completionUri: string): Promise<boolean> {
  try {
    const [file, marker] = await Promise.all([
      FileSystem.getInfoAsync(finalUri),
      FileSystem.readAsStringAsync(completionUri),
    ]);
    const expected = JSON.parse(marker) as { size?: unknown };
    return Boolean(
      file.exists &&
      'size' in file &&
      typeof file.size === 'number' &&
      file.size > 0 &&
      expected.size === file.size,
    );
  } catch {
    return false;
  }
}

/**
 * Run the native detector/encoder and promote its temporary output to a stable
 * app-owned file. The original is deliberately never deleted here: storage.ts
 * persists it separately as local-only data after the sanitized output exists.
 */
export async function prepareFaceBlurredVideo(
  recordingId: string,
  inputUri: string,
  options: PrivacyBlurOptions,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<PreparedFaceBlur> {
  const { pendingUri, finalUri, completionUri } = privacyBlurFileUris(recordingId);
  if (await hasCompletedOutput(finalUri, completionUri)) {
    onProgress(1);
    return {
      videoUri: finalUri,
      outputUri: finalUri,
      framesProcessed: 0,
      framesWithFaces: 0,
      framesWithBackgroundBlur: 0,
      poseSamples: 0,
      totalPoseSamples: 0,
      faceSamples: 0,
      detectorMode: 'rtmdet_nano_rtmpose_t_coco17_dense',
      recovered: true,
    };
  }

  if (signal?.aborted) throw new FaceBlurCancelledError();
  const inputInfo = await FileSystem.getInfoAsync(inputUri);
  const inputSize = inputInfo.exists && 'size' in inputInfo ? inputInfo.size : 0;
  const freeBytes = await FileSystem.getFreeDiskStorageAsync();
  const requiredBytes = Math.max(512 * 1024 * 1024, inputSize * 2 + 256 * 1024 * 1024);
  if (freeBytes < requiredBytes) {
    throw new Error('not enough free storage to create the de-identified copy');
  }
  await FileSystem.deleteAsync(pendingUri, { idempotent: true });
  await FileSystem.deleteAsync(completionUri, { idempotent: true });

  const operationId = `face-blur:${recordingId}`;
  let stalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectStalled: ((error: Error) => void) | undefined;
  const armStallWatchdog = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      void cancelAsync(operationId).catch(() => {});
      rejectStalled?.(new Error('video privacy processing stalled'));
    }, 60_000);
  };
  const subscription = addProgressListener((event) => {
    if (event.operationId !== operationId) return;
    armStallWatchdog();
    onProgress(event.progress);
  });
  const abort = () => {
    void cancelAsync(operationId).catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  armStallWatchdog();

  try {
    const stalledPromise = new Promise<never>((_resolve, reject) => {
      rejectStalled = reject;
    });
    const result = await Promise.race([
      blurVideoAsync(inputUri, pendingUri, operationId, options),
      stalledPromise,
    ]);
    if (signal?.aborted) throw new FaceBlurCancelledError();
    if (result.framesProcessed <= 0) {
      throw new Error('no video frames could be scanned for faces');
    }
    if (result.poseSamples <= 0) {
      throw new Error('no person pose could be detected in this video');
    }
    if (options.blurFaces && result.framesWithFaces <= 0) {
      throw new Error('no face could be located from the detected pose');
    }
    if (options.blurBackground && result.framesWithBackgroundBlur <= 0) {
      throw new Error('the person could not be isolated from the background');
    }
    if (!(await hasUsableFile(pendingUri))) {
      throw new Error('face-blurred video is empty');
    }
    const videoUri = await promotePrivacyBlurredFile(recordingId, pendingUri);
    const promoted = await FileSystem.getInfoAsync(videoUri);
    const promotedSize = promoted.exists && 'size' in promoted ? promoted.size : 0;
    if (!promotedSize) throw new Error('de-identified video is empty after finalization');
    await FileSystem.writeAsStringAsync(completionUri, JSON.stringify({ size: promotedSize }));
    onProgress(1);
    return { ...result, videoUri, recovered: false };
  } catch (error) {
    await FileSystem.deleteAsync(pendingUri, { idempotent: true }).catch(() => {});
    if (stalled) {
      await FileSystem.deleteAsync(finalUri, { idempotent: true }).catch(() => {});
      await FileSystem.deleteAsync(completionUri, { idempotent: true }).catch(() => {});
    }
    if (signal?.aborted) throw new FaceBlurCancelledError();
    throw error;
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    rejectStalled = undefined;
    subscription.remove();
    signal?.removeEventListener('abort', abort);
  }
}
