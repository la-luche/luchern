import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { groupCheckups } from './checkups';
import type { Recording } from './types';

const CHANNEL = 'luche-results';
const PREFIX = 'luche.result-notifications.v1.';
let copy = { title: 'Your results are ready', body: 'All tests are complete. Tap to view your results.', channel: 'Results' };
let permissionRequest: Promise<void> | undefined;
let tail: Promise<unknown> = Promise.resolve();

function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = tail.catch(() => {}).then(task);
  tail = next;
  return next;
}
type Ledger = Record<string, 'waiting' | 'sent'>;
function key(recording: Recording) {
  return JSON.stringify([recording.guestId ?? null, recording.evaluationRun ? 'checkup' : 'recording', recording.evaluationRun?.id ?? recording.id]);
}
async function read(accountId: string): Promise<Ledger> {
  const raw = await AsyncStorage.getItem(PREFIX + accountId);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

export function setResultNotificationCopy(title: string, body: string, channel: string) { copy = { title, body, channel }; }

export async function requestResultNotifications(): Promise<void> {
  if (Platform.OS === 'web' || AppState.currentState === 'background') return;
  if (permissionRequest) return permissionRequest;
  permissionRequest = (async () => {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: copy.channel, importance: Notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    }
  })().finally(() => { permissionRequest = undefined; });
  return permissionRequest;
}

/** Arm only locally accepted work, never an old result imported from the cloud. */
export function armResultNotification(accountId: string, recording: Recording): Promise<void> {
  return serial(async () => {
    if (recording.supersededEvaluationRun) return;
    const ledger = await read(accountId);
    const id = key(recording);
    if (ledger[id]) return;
    ledger[id] = 'waiting';
    await AsyncStorage.setItem(PREFIX + accountId, JSON.stringify(ledger));
  });
}

export function readyNotificationGroups(recordings: Recording[]): Recording[][] {
  const complete = (recording: Recording) => recording.status === 'done' && recording.result != null;
  const checkups = groupCheckups(recordings).filter(run =>
    run.expectedSteps > 0 && run.recordings.length >= run.expectedSteps && run.recordings.every(complete),
  ).map(run => run.recordings);
  const singles = recordings.filter(r => !r.evaluationRun && !r.supersededEvaluationRun && complete(r)).map(r => [r]);
  return [...checkups, ...singles];
}

/** Native notification IDs and the account ledger make repeated polls/relaunch idempotent. */
export function notifyReadyResults(accountId: string, getRecordings: () => Recording[], isCurrent: () => boolean): Promise<void> {
  return serial(async () => {
    if (Platform.OS === 'web' || !isCurrent()) return;
    const ledger = await read(accountId);
    const groups = readyNotificationGroups(getRecordings()).filter(group => ledger[key(group[0])] === 'waiting');
    if (!groups.length) return;
    // A first-run permission prompt can still be open when a short job finishes.
    await permissionRequest;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return;
    for (const group of groups) {
      if (!isCurrent()) return;
      const id = key(group[0]);
      // Permission/storage/native calls yield to deletion, retakes and refreshes.
      // Read live eligibility again immediately before handing off to native.
      const current = readyNotificationGroups(getRecordings()).find(candidate => key(candidate[0]) === id);
      if (!current) continue;
      const recording = current[0];
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${accountId}:${id}`,
        content: {
          title: copy.title, body: copy.body, sound: 'default',
          data: {
            kind: 'results-ready', accountId,
            checkupId: recording.evaluationRun?.id ?? null,
            recordingId: recording.id, guestId: recording.guestId ?? null,
          },
        },
        trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
      });
      ledger[id] = 'sent';
      await AsyncStorage.setItem(PREFIX + accountId, JSON.stringify(ledger));
    }
  });
}

export async function dismissResultNotifications(): Promise<void> {
  if (Platform.OS !== 'web') await Notifications.dismissAllNotificationsAsync();
}
