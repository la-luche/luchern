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
  /** iOS elapsed milliseconds. Scan includes its decode/preprocess/inference
   * subtotals; renderExport includes Core Image rendering and video encoding.
   * Optional for older development clients and Android. */
  timings?: {
    nativeTotalMs: number;
    videoDurationMs: number;
    scanMs: number;
    modelLoadMs: number;
    decodeMs: number;
    displayImageMs: number;
    imageConversionMs: number;
    detectorPreprocessMs: number;
    detectorInferenceMs: number;
    detectorPostprocessMs: number;
    posePreprocessMs?: number;
    poseInferenceMs?: number;
    posePostprocessMs?: number;
    timelineFilterMs: number;
    renderExportMs: number;
  };
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
  prepareForBackgroundAsync?(): Promise<void>;
  blurVideoAsync(
    inputUri: string,
    outputUri: string,
    operationId: string,
    blurFaces: boolean,
    blurBackground: boolean,
  ): Promise<FaceBlurResult>;
  cancelAsync(operationId: string): Promise<void>;
  excludeFromBackupAsync(uri: string): Promise<void>;
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

export async function blurVideoAsync(
  inputUri: string,
  outputUri: string,
  operationId: string,
  options: PrivacyBlurOptions,
): Promise<FaceBlurResult> {
  await nativeModule.prepareForBackgroundAsync?.();
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

export function excludeFromBackupAsync(uri: string): Promise<void> {
  return nativeModule.excludeFromBackupAsync(uri);
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
