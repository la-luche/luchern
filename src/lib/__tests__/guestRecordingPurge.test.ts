jest.mock('@clerk/clerk-expo', () => ({ useUser: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn().mockResolvedValue({ isConnected: false }), useNetworkState: jest.fn() }));
jest.mock('../diagnostics', () => ({ recordDiagnostic: jest.fn(), diagnosticErrorData: () => ({}) }));
jest.mock('../api', () => ({ ApiError: class extends Error {}, ensurePatientOnboarded: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../faceBlur', () => ({ FaceBlurCancelledError: class extends Error {}, prepareFaceBlurredVideo: jest.fn() }));
jest.mock('../faceBlurSettings', () => ({ getPrivacyBlurSettings: jest.fn().mockResolvedValue({ face: false, background: false }) }));
jest.mock('../cloud', () => ({ uploadRecording: jest.fn(), createAnalysisTrial: jest.fn(), pollResult: jest.fn(), pollResultOnce: jest.fn() }));
jest.mock('../recordingSync', () => ({ fetchOwnedTrials: jest.fn().mockResolvedValue([]), mergeTrialScope: (local: unknown) => local }));
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
import { __testing, guestRecordingsForDeletion, pauseGuestRecordings, purgeGuestRecordings } from '../storage';
import { clearGuestDeletionState, markGuestDeleted } from '../guestDeletionState';
import { deleteRecordingFile, deleteRecordingManifest, persistRecordingFile, readRecordingManifests } from '../recordingFiles';
import { clearGuestCaptureIntent } from '../captureRecovery';
import { uploadRecording } from '../cloud';
import type { Recording } from '../types';

const recording = (id: string, guestId?: string): Recording => ({
  id, guestId, testId: 'gait', createdAt: 1, status: 'draft',
  videoUri: `file:///recordings/${id}.privacy-blurred.mp4`,
  originalVideoUri: `file:///recordings/${id}.mp4`,
});

beforeEach(async () => {
  jest.clearAllMocks();
  (readRecordingManifests as jest.Mock).mockResolvedValue([]);
  await clearGuestDeletionState();
  await AsyncStorage.clear();
});

it('purges only the confirmed user, including manifest-only captures and both index generations', async () => {
  const account = 'purge-owner';
  await __testing.writeRecordingSnapshot(account, [recording('delete', 'target'), recording('keep', 'other'), recording('mine')]);
  await __testing.activateAccount(account);
  await expect(purgeGuestRecordings(account, 'target')).rejects.toThrow('not confirmed');
  expect(deleteRecordingFile).not.toHaveBeenCalled();
  // Simulate a camera move whose recovery manifest never reached the index.
  (readRecordingManifests as jest.Mock).mockResolvedValue([recording('interrupted', 'target')]);
  expect(await guestRecordingsForDeletion(account, 'target')).toHaveLength(2);
  await markGuestDeleted(account, 'target');
  await purgeGuestRecordings(account, 'target');
  expect(deleteRecordingManifest).toHaveBeenCalledWith('delete');
  expect(deleteRecordingManifest).toHaveBeenCalledWith('interrupted');
  expect((deleteRecordingFile as jest.Mock).mock.calls.flat()).toEqual(expect.arrayContaining([
    'file:///recordings/delete.mp4', 'file:///recordings/delete.privacy-blurred.mp4',
    'file:///recordings/interrupted.mp4', 'file:///recordings/interrupted.privacy-blurred.mp4',
  ]));
  expect((deleteRecordingFile as jest.Mock).mock.calls.flat().some((uri: string) => /keep|mine/.test(uri))).toBe(false);
  expect(clearGuestCaptureIntent).toHaveBeenCalledWith(account, 'target');
  expect((await __testing.readRecordingSnapshot(account))?.map(r => r.id).sort()).toEqual(['keep', 'mine']);
  const indexRows = (await AsyncStorage.multiGet(await AsyncStorage.getAllKeys()))
    .filter(([key]) => key.startsWith(__testing.chunkStoragePrefix(account))).map(([, value]) => value).join('');
  expect(indexRows).not.toContain('"guestId":"target"');
  await expect(__testing.stage('gait', 'file:///camera/new.mp4', undefined, 'target', undefined, account)).rejects.toThrow('guest unavailable');
  expect(uploadRecording).not.toHaveBeenCalled();
});

it('waits for an in-flight camera move before taking the final deletion count', async () => {
  const account = 'purge-moving';
  await __testing.writeRecordingSnapshot(account, []);
  await __testing.activateAccount(account);
  let finishMove!: () => void;
  let moveStarted!: () => void;
  const started = new Promise<void>(resolve => { moveStarted = resolve; });
  (persistRecordingFile as jest.Mock).mockImplementationOnce(() => {
    moveStarted();
    return new Promise<void>(resolve => { finishMove = resolve; });
  });
  const staging = __testing.stage('gait', 'file:///camera/new.mp4', undefined, 'target', undefined, account);
  await started;
  let paused = false;
  const pause = pauseGuestRecordings(account, 'target').then(release => { paused = true; return release; });
  await Promise.resolve();
  expect(paused).toBe(false);
  finishMove();
  const saved = await staging;
  const release = await pause;
  expect((await guestRecordingsForDeletion(account, 'target')).map(r => r.id)).toEqual([saved.id]);
  await markGuestDeleted(account, 'target');
  await purgeGuestRecordings(account, 'target');
  release();
  expect(deleteRecordingManifest).toHaveBeenCalledWith(saved.id);
  expect(await __testing.readRecordingSnapshot(account)).toEqual([]);
});
