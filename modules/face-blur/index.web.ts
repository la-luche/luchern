import type { EventSubscription } from 'expo-modules-core';

import type { FaceBlurProgressEvent, FaceBlurResult, PrivacyBlurOptions } from './index';

export async function blurVideoAsync(
  _inputUri: string,
  _outputUri: string,
  _operationId: string,
  _options: PrivacyBlurOptions,
): Promise<FaceBlurResult> {
  throw new Error('On-device video privacy blurring is only available in the iOS and Android apps.');
}

export async function cancelAsync(_operationId: string): Promise<void> {}

export function addProgressListener(
  _listener: (event: FaceBlurProgressEvent) => void,
): EventSubscription {
  return { remove() {} };
}
