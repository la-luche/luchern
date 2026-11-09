import type { Recording } from './types';

/** Server scoring continues independently once a trial has been created. */
export function needsDeviceProcessing(recording: Pick<Recording, 'status' | 'jobId'>): boolean {
  return recording.status === 'preparing' || recording.status === 'uploading' ||
    (recording.status === 'processing' && !recording.jobId);
}

export function deviceProcessingFraction(recording: Recording): number {
  if (recording.status === 'preparing') return (recording.privacyBlurProgress ?? 0) * 0.8;
  if (recording.status === 'uploading') return 0.8 + (recording.uploadProgress ?? 0) * 0.19;
  if (recording.status === 'processing') return recording.jobId ? 1 : 0.99;
  return ['done', 'needs_retry', 'unscored'].includes(recording.status) ? 1 : 0;
}
