import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import type { EvaluatedSide, TestId } from './tests';

const KEY_PREFIX = 'luche.capture-intent.v1.';

export type CaptureIntent = {
  testId: TestId;
  guestId?: string;
  evaluatedSide?: EvaluatedSide;
  startedAt: number;
  outputUri?: string;
};

function key(accountId: string): string {
  return `${KEY_PREFIX}${accountId}`;
}

export async function beginCaptureIntent(
  accountId: string,
  intent: Omit<CaptureIntent, 'startedAt' | 'outputUri'>,
): Promise<void> {
  await AsyncStorage.setItem(key(accountId), JSON.stringify({ ...intent, startedAt: Date.now() }));
}

export async function attachCaptureOutput(accountId: string, outputUri: string): Promise<void> {
  const raw = await AsyncStorage.getItem(key(accountId));
  if (!raw) return;
  const intent = JSON.parse(raw) as CaptureIntent;
  await AsyncStorage.setItem(key(accountId), JSON.stringify({ ...intent, outputUri }));
}

export async function clearCaptureIntent(accountId: string): Promise<void> {
  await AsyncStorage.removeItem(key(accountId));
}

/** Logout/account deletion must remove raw camera outputs that never reached
 * durable staging. Only delete files inside Expo's cache directory; a corrupt
 * journal must never be able to target Documents or an external provider. */
export async function clearAllCaptureIntentsAndFiles(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(KEY_PREFIX));
  await Promise.all(
    keys.map(async (intentKey) => {
      try {
        const raw = await AsyncStorage.getItem(intentKey);
        const intent = raw ? (JSON.parse(raw) as CaptureIntent) : null;
        const candidate = intent?.outputUri;
        if (
          candidate &&
          FileSystem.cacheDirectory &&
          candidate.startsWith(FileSystem.cacheDirectory)
        ) {
          await FileSystem.deleteAsync(candidate, { idempotent: true });
        }
      } catch {
        // The key is still removed below; malformed metadata does not own a file.
      }
    }),
  );
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
}

export async function recoverCaptureIntent(
  accountId: string,
): Promise<(CaptureIntent & { sourceUri: string }) | null> {
  const raw = await AsyncStorage.getItem(key(accountId));
  if (!raw) return null;
  try {
    const intent = JSON.parse(raw) as CaptureIntent;
    if (!intent.testId || typeof intent.startedAt !== 'number') throw new Error('invalid intent');
    if (intent.outputUri) {
      const output = await FileSystem.getInfoAsync(intent.outputUri);
      if (output.exists && 'size' in output && output.size > 0) {
        return { ...intent, sourceUri: intent.outputUri };
      }
    }
    // Before recordAsync resolves, Expo gives us no stable filename. Never
    // guess from other cache videos: associating an unrelated clip with this
    // guest/test is worse than reporting an interrupted capture.
  } catch {
    // Invalid/torn journals are safe to drop; they never own the video file.
  }
  await clearCaptureIntent(accountId);
  return null;
}

export const __testing = { key };
