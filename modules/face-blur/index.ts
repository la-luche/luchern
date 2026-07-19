import {
  type EventSubscription,
  NativeModule,
  requireNativeModule,
} from 'expo-modules-core';

export type FaceBlurProgressEvent = {
  operationId: string;
  progress: number;
};

export type FaceBlurResult = {
  outputUri: string;
  framesProcessed: number;
  framesWithFaces: number;
  detections: number;
};

type FaceBlurEvents = {
  onFaceBlurProgress(event: FaceBlurProgressEvent): void;
};

declare class FaceBlurNativeModule extends NativeModule<FaceBlurEvents> {
  blurVideoAsync(inputUri: string, outputUri: string, operationId: string): Promise<FaceBlurResult>;
  cancelAsync(operationId: string): Promise<void>;
}

const nativeModule = requireNativeModule<FaceBlurNativeModule>('FaceBlur');

export function blurVideoAsync(
  inputUri: string,
  outputUri: string,
  operationId: string,
): Promise<FaceBlurResult> {
  return nativeModule.blurVideoAsync(inputUri, outputUri, operationId);
}

export function cancelAsync(operationId: string): Promise<void> {
  return nativeModule.cancelAsync(operationId);
}

export function addProgressListener(
  listener: (event: FaceBlurProgressEvent) => void,
): EventSubscription {
  return nativeModule.addListener('onFaceBlurProgress', listener);
}
