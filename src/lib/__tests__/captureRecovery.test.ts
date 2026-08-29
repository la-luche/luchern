jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  readDirectoryAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import {
  __testing,
  attachCaptureOutput,
  beginCaptureIntent,
  clearAllCaptureIntentsAndFiles,
  clearCaptureIntent,
  recoverCaptureIntent,
} from '../captureRecovery';

describe('capture recovery journal', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('recovers the exact camera output attached before durable staging', async () => {
    await beginCaptureIntent('account-a', {
      testId: 'gait',
      guestId: 'guest-a',
    });
    await attachCaptureOutput('account-a', 'file:///cache/Camera/capture.mov');
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 123 });

    await expect(recoverCaptureIntent('account-a')).resolves.toMatchObject({
      testId: 'gait',
      guestId: 'guest-a',
      sourceUri: 'file:///cache/Camera/capture.mov',
    });
  });

  it('never guesses an unrelated cache video before URI attachment', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    await beginCaptureIntent('account-a', { testId: 'fingerTapping' });
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue(['Camera']);

    await expect(recoverCaptureIntent('account-a')).resolves.toBeNull();
    expect(FileSystem.readDirectoryAsync).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('clears a journal only after explicit cleanup', async () => {
    await beginCaptureIntent('account-a', { testId: 'gait' });
    await clearCaptureIntent('account-a');
    expect(await AsyncStorage.getItem(__testing.key('account-a'))).toBeNull();
  });

  it('purges attached raw cache output and journals on logout', async () => {
    await beginCaptureIntent('account-a', { testId: 'gait' });
    await attachCaptureOutput('account-a', 'file:///cache/Camera/capture.mov');

    await clearAllCaptureIntentsAndFiles();

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///cache/Camera/capture.mov',
      { idempotent: true },
    );
    expect(await AsyncStorage.getItem(__testing.key('account-a'))).toBeNull();
  });

  it('does not delete guessed cache files when death preceded URI attachment', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    await beginCaptureIntent('account-a', { testId: 'gait' });
    await clearAllCaptureIntentsAndFiles();

    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});
