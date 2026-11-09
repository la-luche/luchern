import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { armResultNotification, notifyReadyResults, readyNotificationGroups } from '../resultNotifications';
import type { Recording } from '../types';

const run = { id: 'checkup', expectedSteps: 2, startedAt: 1 };
function clip(id: string, side: 'left' | 'right', extra: Partial<Recording> = {}): Recording {
  return { id, testId: 'fingerTapping', evaluatedSide: side, evaluationRun: run,
    createdAt: 1, status: 'done', result: { score: .1, label: 'Normal', isDemo: false }, ...extra };
}
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
});

it('waits for every expected test, with a real result for each', () => {
  const left = clip('left', 'left');
  expect(readyNotificationGroups([left])).toEqual([]);
  for (const status of ['draft', 'preparing', 'uploading', 'processing', 'needs_retry', 'failed', 'blur_failed'] as const) {
    expect(readyNotificationGroups([left, clip('right', 'right', { status })])).toEqual([]);
  }
  expect(readyNotificationGroups([left, clip('right', 'right', { result: undefined })])).toEqual([]);
  expect(readyNotificationGroups([left, clip('right', 'right')])).toHaveLength(1);
});

it('does not count duplicate sides or combine two patients', () => {
  expect(readyNotificationGroups([clip('a', 'left'), clip('b', 'left')])).toEqual([]);
  expect(readyNotificationGroups([clip('a', 'left', { guestId: 'a' }), clip('b', 'right', { guestId: 'b' })])).toEqual([]);
  expect(readyNotificationGroups([clip('a', 'left'), clip('b', 'right'), clip('retake', 'right', { status: 'processing', createdAt: 2 })])).toEqual([]);
});

it('notifies once per armed checkup across repeated polling and never imports old ready history', async () => {
  const recordings = [clip('left', 'left'), clip('right', 'right')];
  await notifyReadyResults('account', () => recordings, () => true);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  await armResultNotification('account', recordings[0]);
  await Promise.all([
    notifyReadyResults('account', () => recordings, () => true),
    notifyReadyResults('account', () => recordings, () => true),
  ]);
  await armResultNotification('account', recordings[1]);
  await notifyReadyResults('account', () => recordings, () => true);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({ title: 'Your results are ready', data: expect.objectContaining({ accountId: 'account', checkupId: 'checkup' }) }),
  }));
});

it('respects permissions and account changes without falsely consuming the notification', async () => {
  const recordings = [clip('left', 'left'), clip('right', 'right')];
  await armResultNotification('account', recordings[0]);
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  await notifyReadyResults('account', () => recordings, () => true);
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  await notifyReadyResults('account', () => recordings, () => false);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  await notifyReadyResults('account', () => recordings, () => true);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

it.each(['deletion', 'retake', 'account change'])('revalidates %s after the permission lookup yields', async change => {
  let recordings = [clip('left', 'left'), clip('right', 'right')];
  let current = true;
  await armResultNotification('account', recordings[0]);
  let permit!: (value: unknown) => void;
  let checked!: () => void;
  const checking = new Promise<void>(resolve => { checked = resolve; });
  (Notifications.getPermissionsAsync as jest.Mock).mockImplementationOnce(() => {
    checked();
    return new Promise(resolve => { permit = resolve; });
  });
  const sending = notifyReadyResults('account', () => recordings, () => current);
  await checking;
  if (change === 'deletion') recordings = [];
  else if (change === 'retake') recordings.push(clip('retake', 'right', { createdAt: 2, status: 'processing' }));
  else current = false;
  permit({ granted: true });
  await sending;
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  // No sent marker was consumed by the obsolete eligibility check.
  recordings = [clip('left', 'left'), clip('right', 'right')];
  current = true;
  await notifyReadyResults('account', () => recordings, () => current);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});
