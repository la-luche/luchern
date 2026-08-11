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

/**
 * Run the native detector/encoder and promote its temporary output to a stable
 * app-owned file. The original is deliberately not deleted here: storage.ts
 * first persists the new URI, then removes the original as a crash-safe commit.
 */
export async function prepareFaceBlurredVideo(
  recordingId: string,
  inputUri: string,
  options: Omit<PrivacyBlurOptions, 'sdkKey'>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<PreparedFaceBlur> {
  const { pendingUri, finalUri } = privacyBlurFileUris(recordingId);
  if (await hasUsableFile(finalUri)) {
    onProgress(1);
    return {
      videoUri: finalUri,
      outputUri: finalUri,
      framesProcessed: 0,
      framesWithFaces: 0,
      framesWithBackgroundBlur: 0,
      poseSamples: 0,
      recovered: true,
    };
  }

  if (signal?.aborted) throw new FaceBlurCancelledError();
  await FileSystem.deleteAsync(pendingUri, { idempotent: true });

  const operationId = `face-blur:${recordingId}`;
  const subscription = addProgressListener((event) => {
    if (event.operationId === operationId) onProgress(event.progress);
  });
  const abort = () => {
    void cancelAsync(operationId).catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const result = await blurVideoAsync(inputUri, pendingUri, operationId, {
      ...options,
      sdkKey: process.env.EXPO_PUBLIC_QUICKPOSE_SDK_KEY ?? '',
    });
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
    onProgress(1);
    return { ...result, videoUri, recovered: false };
  } catch (error) {
    await FileSystem.deleteAsync(pendingUri, { idempotent: true }).catch(() => {});
    if (signal?.aborted) throw new FaceBlurCancelledError();
    throw error;
  } finally {
    subscription.remove();
    signal?.removeEventListener('abort', abort);
  }
}
