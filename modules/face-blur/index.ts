import {
  type EventSubscription,
  NativeModule,
  requireNativeModule,
} from 'expo-modules-core';

export type FaceBlurProgressEvent = {
  operationId: string;
  progress: number;
};

export type PrivacyBlurOptions = {
  blurFaces: boolean;
  blurBackground: boolean;
  sdkKey: string;
  poseSampleIntervalMs?: number;
};

export type FaceBlurResult = {
  outputUri: string;
  framesProcessed: number;
  framesWithFaces: number;
  framesWithBackgroundBlur: number;
  poseSamples: number;
};

type FaceBlurEvents = {
  onFaceBlurProgress(event: FaceBlurProgressEvent): void;
};

declare class FaceBlurNativeModule extends NativeModule<FaceBlurEvents> {
  blurVideoAsync(
    inputUri: string,
    outputUri: string,
    operationId: string,
    sdkKey: string,
    blurFaces: boolean,
    blurBackground: boolean,
    poseSampleIntervalMs: number,
  ): Promise<FaceBlurResult>;
  cancelAsync(operationId: string): Promise<void>;
}

const nativeModule = requireNativeModule<FaceBlurNativeModule>('FaceBlur');

export function blurVideoAsync(
  inputUri: string,
  outputUri: string,
  operationId: string,
  options: PrivacyBlurOptions,
): Promise<FaceBlurResult> {
  return nativeModule.blurVideoAsync(
    inputUri,
    outputUri,
    operationId,
    options.sdkKey,
    options.blurFaces,
    options.blurBackground,
    options.poseSampleIntervalMs ?? 200,
  );
}

export function cancelAsync(operationId: string): Promise<void> {
  return nativeModule.cancelAsync(operationId);
}

export function addProgressListener(
  listener: (event: FaceBlurProgressEvent) => void,
): EventSubscription {
  return nativeModule.addListener('onFaceBlurProgress', listener);
}
