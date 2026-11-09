import { deviceProcessingFraction, needsDeviceProcessing } from '../deviceProcessing';
import type { Recording } from '../types';

const recording = (partial: Partial<Recording>): Recording => ({
  id: 'capture', testId: 'fingerTapping', createdAt: 0, videoUri: 'file:///capture.mp4',
  status: 'preparing', ...partial,
});

it('keeps the device task until the uploaded recording has a server job', () => {
  for (const status of ['preparing', 'uploading', 'processing'] as const) {
    expect(needsDeviceProcessing(recording({ status }))).toBe(true);
  }
  const remote = recording({ status: 'processing', jobId: '1550' });
  expect(needsDeviceProcessing(remote)).toBe(false);
  expect(deviceProcessingFraction(remote)).toBe(1);
});

it('does not acquire device time for imported videos, drafts, or finished results', () => {
  for (const status of ['unscored', 'draft', 'done', 'needs_retry', 'failed', 'blur_failed'] as const) {
    expect(needsDeviceProcessing(recording({ status }))).toBe(false);
  }
});

it('reports real preparation and upload progress before trial creation completes', () => {
  expect(deviceProcessingFraction(recording({ privacyBlurProgress: 0.5 }))).toBeCloseTo(0.4);
  expect(deviceProcessingFraction(recording({ status: 'uploading', uploadProgress: 1 }))).toBeCloseTo(0.99);
  expect(deviceProcessingFraction(recording({ status: 'processing' }))).toBeCloseTo(0.99);
});
