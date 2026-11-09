jest.mock('@clerk/clerk-expo', () => ({ useUser: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn().mockResolvedValue({ isConnected: false }), useNetworkState: jest.fn() }));
jest.mock('../diagnostics', () => ({ recordDiagnostic: jest.fn(), diagnosticErrorData: () => ({}) }));
jest.mock('../api', () => ({ ApiError: class extends Error {}, ensurePatientOnboarded: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../faceBlur', () => ({ FaceBlurCancelledError: class extends Error {}, prepareFaceBlurredVideo: jest.fn() }));
jest.mock('../backgroundRuntime', () => ({
  ensureBackgroundWork: jest.fn().mockResolvedValue('continued'),
  allowBackgroundWork: jest.fn(), endBackgroundWork: jest.fn(),
  isBackgroundWorkPaused: () => false, updateBackgroundWork: jest.fn(),
  onBackgroundExpiration: jest.fn(), onBackgroundTick: jest.fn(),
}));
jest.mock('../faceBlurSettings', () => ({ getPrivacyBlurSettings: jest.fn().mockResolvedValue({ face: false, background: false }) }));
jest.mock('../cloud', () => ({ uploadRecording: jest.fn(), createAnalysisTrial: jest.fn(), pollResult: jest.fn(), pollResultOnce: jest.fn() }));
jest.mock('../recordingSync', () => ({ fetchOwnedTrials: jest.fn().mockResolvedValue({ trials: [] }), mergeTrialScope: (local: unknown) => ({ recordings: local, localUrisToDelete: [] }) }));
jest.mock('../guestStorage', () => ({ activateGuestAccount: jest.fn(), ensureGuestSyncedForAccount: jest.fn() }));
jest.mock('../selfProfile', () => ({ clearSelfProfiles: jest.fn() }));
jest.mock('../captureRecovery', () => ({
  clearCaptureIntent: jest.fn().mockResolvedValue(undefined),
  clearGuestCaptureIntent: jest.fn().mockResolvedValue(undefined),
  recoverCaptureIntent: jest.fn().mockResolvedValue(null),
}));
jest.mock('../recordingFiles', () => ({
  readRecordingManifests: jest.fn().mockResolvedValue([]),
  rebindRecordingFileUri: jest.fn(async uri => uri),
  recordingFileExists: jest.fn().mockResolvedValue(true),
  recordingFileSize: jest.fn().mockResolvedValue(100),
  recordingFileUri: (uri: string, id: string) => `file:///recordings/${id}.mp4`,
  persistRecordingFile: jest.fn().mockResolvedValue('file:///recordings/moved.mp4'),
  persistRecordingManifest: jest.fn().mockResolvedValue(undefined),
  deleteRecordingFile: jest.fn().mockResolvedValue(undefined),
  deleteRecordingManifest: jest.fn().mockResolvedValue(undefined),
  deletePrivacyBlurArtifacts: jest.fn().mockResolvedValue(undefined),
  excludeRecordingsFromBackup: jest.fn().mockResolvedValue(undefined),
  clearRecordingExportTemps: jest.fn().mockResolvedValue(undefined),
}));


import AsyncStorage from '@react-native-async-storage/async-storage';
import { __testing, suspendRecordingAccessForAuthLoss } from '../storage';
import { persistRecordingManifest, deleteRecordingFile } from '../recordingFiles';
import { setCaptureActive } from '../captureActivity';
import type { Recording } from '../types';
import { AppState } from 'react-native';
import { ensureBackgroundWork } from '../backgroundRuntime';
import { prepareFaceBlurredVideo } from '../faceBlur';
import * as Notifications from 'expo-notifications';
import { armResultNotification } from '../resultNotifications';
import { markGuestDeleted } from '../guestDeletionState';

const run = { id: 'run', startedAt: 1, expectedSteps: 13 };
function clip(id: string, createdAt: number, extra: Partial<Recording> = {}): Recording {
  return { id, createdAt, testId: 'fingerTapping', evaluatedSide: 'left', guestId: 'guest',
    evaluationRun: run, status: 'draft', videoUri: `file:///recordings/${id}.mp4`, ...extra };
}
beforeEach(async () => {
  jest.clearAllMocks();
  suspendRecordingAccessForAuthLoss();
  setCaptureActive(true);
  await AsyncStorage.clear();
  AppState.currentState = 'active';
});

it('waits for background execution before scanning and advances the video queue after switching apps', async () => {
  let grant!: (mode: string) => void;
  const permission = new Promise<string>(resolve => { grant = resolve; });
  (ensureBackgroundWork as jest.Mock).mockReturnValue(permission);
  const complete: Array<() => void> = [];
  const states: string[] = [];
  (prepareFaceBlurredVideo as jest.Mock).mockImplementation((id: string) => new Promise(resolve => {
    states.push(AppState.currentState);
    complete.push(() => resolve({ videoUri: `file:///${id}.blurred.mp4`, recovered: false, framesProcessed: 64 }));
  }));
  const flush = async () => { for (let i = 0; i < 30; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  const records = ['one', 'two', 'three'].map((id, i) => clip(id, i, {
    guestId: undefined, evaluationRun: undefined, originalVideoUri: `file:///${id}.mp4`,
    status: 'preparing', privacyBlurState: 'pending', faceBlurRequested: true,
  }));
  await __testing.writeRecordingSnapshot('background-test', records);
  await __testing.activateAccount('background-test');
  setCaptureActive(false);
  await flush();
  expect(prepareFaceBlurredVideo).not.toHaveBeenCalled();
  grant('continued');
  await flush();
  expect(complete).toHaveLength(1);
  const starts = (ensureBackgroundWork as jest.Mock).mock.calls.length;
  __testing.resumePending(); // foreground recovery also covers an existing drive
  await flush();
  expect((ensureBackgroundWork as jest.Mock).mock.calls.length).toBeGreaterThan(starts);
  expect(complete).toHaveLength(1);
  AppState.currentState = 'background';
  complete[0]();
  await flush();
  expect(complete).toHaveLength(2);
  complete[1]();
  await flush();
  expect(complete).toHaveLength(3);
  complete[2]();
  await flush();
  expect(states).toEqual(['active', 'background', 'background']);
  expect((await __testing.ensureLoaded()).every(r => r.privacyBlurState === 'completed')).toBe(true);
  (ensureBackgroundWork as jest.Mock).mockResolvedValue('continued');
});
afterEach(() => { suspendRecordingAccessForAuthLoss(); setCaptureActive(false); });

it('notifies a completed checkup while an unrelated privacy job is still queued', async () => {
  const ready = clip('ready', 1, {
    status: 'done', jobId: '42', evaluationRun: { ...run, expectedSteps: 1 },
    result: { score: .1, label: 'Normal', isDemo: false },
  });
  const queued = clip('queued', 2, {
    evaluationRun: { ...run, id: 'other' }, status: 'preparing',
    privacyBlurState: 'pending', faceBlurRequested: true,
  });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  await armResultNotification('independent', ready);
  await __testing.writeRecordingSnapshot('independent', [ready, queued]);
  await __testing.activateAccount('independent');
  __testing.reconcileBackgroundWork();
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
  expect((await __testing.ensureLoaded()).find(r => r.id === 'queued')?.status).toBe('preparing');
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({ data: expect.objectContaining({ checkupId: 'run' }) }),
  }));
});

it('does not announce a deleted guest while their cached files are still being purged', async () => {
  const ready = clip('ready', 1, {
    status: 'done', jobId: '42', evaluationRun: { ...run, expectedSteps: 1 },
    result: { score: .1, label: 'Normal', isDemo: false },
  });
  let permit!: (value: unknown) => void;
  let checked!: () => void;
  const checking = new Promise<void>(resolve => { checked = resolve; });
  (Notifications.getPermissionsAsync as jest.Mock).mockImplementationOnce(() => {
    checked(); return new Promise(resolve => { permit = resolve; });
  });
  let deleted!: () => void;
  (deleteRecordingFile as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { deleted = resolve; }));
  await armResultNotification('deleted-notification', ready);
  await __testing.writeRecordingSnapshot('deleted-notification', [ready]);
  await __testing.activateAccount('deleted-notification');
  await checking;
  await markGuestDeleted('deleted-notification', 'guest');
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
  expect(await __testing.ensureLoaded()).toHaveLength(1);
  permit({ granted: true });
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  deleted();
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
});

it('queues an accepted checkup clip and durably keeps the previous result as a standalone test', async () => {
  const old = clip('old', 1, { status: 'done', jobId: '42', result: { score: .5, label: 'Mild', isDemo: false } });
  await __testing.writeRecordingSnapshot('owner', [clip('new', 2), old, clip('right', 1, { evaluatedSide: 'right' })]);
  await __testing.activateAccount('owner');
  expect((await __testing.ensureLoaded()).find(r => r.id === 'old')?.evaluationRun).toEqual(run);
  const accepted = await __testing.finalizeDraft('new');
  expect(accepted.status).toBe('uploading');
  expect(accepted.evaluationRun).toEqual(run);
  const previous = (await __testing.ensureLoaded()).find(r => r.id === 'old')!;
  expect(previous.evaluationRun).toBeUndefined();
  expect(previous).toMatchObject({ supersededEvaluationRun: run, jobId: '42', result: old.result, videoUri: old.videoUri });
  expect((await __testing.ensureLoaded()).find(r => r.id === 'right')?.evaluationRun).toEqual(run);
  expect(persistRecordingManifest).toHaveBeenCalledWith('owner', expect.objectContaining({ id: 'old', supersededEvaluationRun: run }));
  expect(deleteRecordingFile).not.toHaveBeenCalled();

  // A native export/upload already in flight can finish with its old snapshot.
  await __testing.patch('old', { ...old, status: 'processing' });
  expect((await __testing.ensureLoaded()).find(r => r.id === 'old')?.evaluationRun).toBeUndefined();
  await __testing.finalizeDraft('new');
  expect((await __testing.ensureLoaded()).filter(r => r.evaluationRun?.id === 'run').map(r => r.id).sort()).toEqual(['new', 'right']);
});
it('repairs a crash after accepting the new clip but before detaching the old one', async () => {
  await __testing.writeRecordingSnapshot('recovery', [clip('old', 1, { status: 'processing', jobId: '42' }), clip('new', 2, { status: 'preparing', privacyBlurState: 'pending' })]);
  await __testing.activateAccount('recovery');
  const recordings = await __testing.ensureLoaded();
  expect(recordings.find(r => r.id === 'old')?.evaluationRun).toBeUndefined();
  expect(recordings.find(r => r.id === 'new')?.evaluationRun).toEqual(run);
  expect(persistRecordingManifest).toHaveBeenCalledWith('recovery', expect.objectContaining({ id: 'old', supersededEvaluationRun: run }));
});
it('keeps an existing checkup clip when its replacement has only been staged', async () => {
  await __testing.writeRecordingSnapshot('draft-only', [clip('old', 1, { status: 'done', jobId: '42' }), clip('new', 2)]);
  await __testing.activateAccount('draft-only');
  expect((await __testing.ensureLoaded()).find(r => r.id === 'old')?.evaluationRun).toEqual(run);
});
