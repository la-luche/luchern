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
};

export type FaceBlurResult = {
  outputUri: string;
  framesProcessed: number;
  framesWithFaces: number;
  framesWithBackgroundBlur: number;
  poseSamples: number;
  totalPoseSamples: number;
  faceSamples: number;
  detectorMode: 'rtmdet_nano_rtmpose_t_coco17_dense';
};

export type PoseRectDiagnostic = {
  frameIndex: number;
  seconds: number;
  person: [number, number, number, number] | null;
  face: [number, number, number, number] | null;
};

type FaceBlurEvents = {
  onFaceBlurProgress(event: FaceBlurProgressEvent): void;
};

declare class FaceBlurNativeModule extends NativeModule<FaceBlurEvents> {
  blurVideoAsync(
    inputUri: string,
    outputUri: string,
    operationId: string,
    blurFaces: boolean,
    blurBackground: boolean,
  ): Promise<FaceBlurResult>;
  cancelAsync(operationId: string): Promise<void>;
  renderPoseOverlayVideoAsync(
    inputUri: string,
    outputUri: string,
    operationId: string,
  ): Promise<FaceBlurResult>;
  diagnoseImageAsync(
    inputUri: string,
    outputDirectory: string,
  ): Promise<{
    imageWidth: number;
    imageHeight: number;
    keypointCount: number;
    outputDirectory: string;
  }>;
  diagnoseVideoRectsAsync(inputUri: string): Promise<{
    frames: PoseRectDiagnostic[];
  }>;
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
    options.blurFaces,
    options.blurBackground,
  );
}

export function cancelAsync(operationId: string): Promise<void> {
  return nativeModule.cancelAsync(operationId);
}

export function renderPoseOverlayVideoAsync(
  inputUri: string,
  outputUri: string,
  operationId: string,
) {
  return nativeModule.renderPoseOverlayVideoAsync(inputUri, outputUri, operationId);
}

export function diagnoseImageAsync(
  inputUri: string,
  outputDirectory: string,
) {
  return nativeModule.diagnoseImageAsync(inputUri, outputDirectory);
}

export function diagnoseVideoRectsAsync(inputUri: string) {
  return nativeModule.diagnoseVideoRectsAsync(inputUri);
}

export function addProgressListener(
  listener: (event: FaceBlurProgressEvent) => void,
): EventSubscription {
  return nativeModule.addListener('onFaceBlurProgress', listener);
}
