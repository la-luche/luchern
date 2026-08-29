jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  moveAsync: jest.fn().mockResolvedValue(undefined),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn(),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
  getFreeDiskStorageAsync: jest.fn().mockResolvedValue(10 * 1024 * 1024 * 1024),
}));
jest.mock('../../../modules/face-blur', () => ({
  excludeFromBackupAsync: jest.fn().mockResolvedValue(undefined),
}));

import * as FileSystem from 'expo-file-system/legacy';
import { excludeFromBackupAsync } from '../../../modules/face-blur';
import {
  __testing,
  deleteAllRecordingFiles,
  deleteRecordingFile,
  deleteRecordingManifest,
  deletePrivacyBlurArtifacts,
  persistRecordingManifest,
  privacyBlurFileUris,
  persistRecordingFile,
  promotePrivacyBlurredFile,
  readRecordingManifests,
  rebindRecordingFileUri,
  recordingFileExists,
} from '../recordingFiles';

describe('recording file lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 123 });
    (FileSystem.moveAsync as jest.Mock).mockResolvedValue(undefined);
    (FileSystem.deleteAsync as jest.Mock).mockResolvedValue(undefined);
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([]);
  });

  it('preserves known video extensions and defaults unknown URIs to mp4', () => {
    expect(__testing.extensionFor('file:///cache/a.MOV?x=1')).toBe('mov');
    expect(__testing.extensionFor('file:///cache/no-extension')).toBe('mp4');
  });

  it('moves a camera cache file into the documents directory', async () => {
    const uri = await persistRecordingFile('file:///cache/capture.mov', 'rec-1');
    expect(uri).toBe('file:///documents/recordings/rec-1.mov');
    expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith(
      'file:///documents/recordings/',
      { intermediates: true },
    );
    expect(FileSystem.moveAsync).toHaveBeenCalledWith({
      from: 'file:///cache/capture.mov',
      to: uri,
    });
    expect(FileSystem.copyAsync).not.toHaveBeenCalled();
    expect(excludeFromBackupAsync).toHaveBeenCalledWith('file:///documents/recordings/');
    expect(excludeFromBackupAsync).toHaveBeenCalledWith(uri);
  });

  it('rebinds a stale iOS container URI when the recording exists in current Documents', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: true, size: 123 });
    const uri = await rebindRecordingFileUri(
      'file:///var/mobile/Containers/Data/Application/OLD/Documents/recordings/rec-1.mov',
    );
    expect(uri).toBe('file:///documents/recordings/rec-1.mov');
    expect(FileSystem.getInfoAsync).toHaveBeenCalledWith(
      'file:///documents/recordings/rec-1.mov',
    );
  });

  it('leaves an old URI untouched when no matching current recording exists', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: false });
    const stale =
      'file:///var/mobile/Containers/Data/Application/OLD/Documents/recordings/rec-missing.mov';
    await expect(rebindRecordingFileUri(stale)).resolves.toBe(stale);
  });

  it('checks a persisted URI without modifying or deleting it', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: true, size: 123 });

    await expect(recordingFileExists('file:///documents/recordings/rec-1.mp4')).resolves.toBe(true);

    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(FileSystem.moveAsync).not.toHaveBeenCalled();
  });

  it('falls back to copy plus cache cleanup when a direct move fails', async () => {
    (FileSystem.moveAsync as jest.Mock).mockRejectedValueOnce(new Error('provider move failed'));
    const uri = await persistRecordingFile('file:///cache/capture.mp4', 'rec-2');
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: 'file:///cache/capture.mp4',
      to: `${uri}.copying`,
    });
    expect(FileSystem.moveAsync).toHaveBeenLastCalledWith({
      from: `${uri}.copying`,
      to: uri,
    });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///cache/capture.mp4',
      { idempotent: true },
    );
  });

  it('fails closed if a copied camera-cache original cannot be deleted', async () => {
    (FileSystem.moveAsync as jest.Mock).mockRejectedValueOnce(new Error('provider move failed'));
    (FileSystem.deleteAsync as jest.Mock).mockImplementation((uri: string) =>
      uri === 'file:///cache/capture.mp4'
        ? Promise.reject(new Error('cache delete failed'))
        : Promise.resolve(),
    );

    await expect(
      persistRecordingFile('file:///cache/capture.mp4', 'rec-private'),
    ).rejects.toThrow('cache delete failed');

    expect(FileSystem.deleteAsync).toHaveBeenLastCalledWith(
      'file:///documents/recordings/rec-private.mp4',
      { idempotent: true },
    );
  });

  it('deletes local files idempotently', async () => {
    await deleteRecordingFile('file:///documents/recordings/rec-1.mov');
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///documents/recordings/rec-1.mov',
      { idempotent: true },
    );
  });

  it('deletes the complete recordings directory on logout', async () => {
    await deleteAllRecordingFiles();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///documents/recordings/',
      { idempotent: true },
    );
  });

  it('atomically writes an account-scoped recovery manifest beside the video', async () => {
    const recording = {
      id: 'rec-1',
      testId: 'gait' as const,
      createdAt: 123,
      videoUri: 'file:///documents/recordings/rec-1.mov',
      status: 'uploading' as const,
    };

    await persistRecordingManifest('account-a', recording);

    const pending = 'file:///documents/recordings/rec-1.recording.0.json.pending';
    const final = 'file:///documents/recordings/rec-1.recording.0.json';
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      pending,
      JSON.stringify({ version: 1, accountId: 'account-a', recording }),
    );
    expect(FileSystem.moveAsync).toHaveBeenCalledWith({ from: pending, to: final });
  });

  it('recovers only same-account manifests whose video still exists', async () => {
    (FileSystem.getInfoAsync as jest.Mock)
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ exists: true, size: 123 })
      .mockResolvedValue({ exists: false });
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
      'rec-1.recording.0.json',
      'ignore.mp4',
    ]);
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(
      JSON.stringify({
        version: 1,
        accountId: 'account-a',
        recording: {
          id: 'rec-1',
          testId: 'gait',
          createdAt: 123,
          videoUri: 'file:///documents/recordings/rec-1.mov',
          status: 'uploading',
        },
      }),
    );

    await expect(readRecordingManifests('account-a')).resolves.toEqual([
      expect.objectContaining({ id: 'rec-1' }),
    ]);
    await expect(readRecordingManifests('account-b')).resolves.toEqual([]);
  });

  it('rejects a partial destination and re-stages the intact journal source', async () => {
    (FileSystem.getInfoAsync as jest.Mock)
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ exists: true, size: 50 })
      .mockResolvedValueOnce({ exists: true, size: 50 })
      .mockResolvedValueOnce({ exists: true, size: 123 })
      .mockResolvedValueOnce({ exists: true, size: 123 })
      .mockResolvedValueOnce({ exists: true, size: 123 });
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
      'rec-partial.recording.1.json',
    ]);
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(
      JSON.stringify({
        version: 1,
        accountId: 'account-a',
        recording: {
          id: 'rec-partial',
          testId: 'gait',
          createdAt: 123,
          localRevision: 1,
          videoUri: 'file:///documents/recordings/rec-partial.mov',
          originalVideoUri: 'file:///documents/recordings/rec-partial.mov',
          stagingSourceUri: 'file:///cache/capture.mov',
          stagingSourceSize: 123,
          status: 'draft',
        },
      }),
    );

    await expect(readRecordingManifests('account-a')).resolves.toEqual([
      expect.objectContaining({
        id: 'rec-partial',
        videoUri: 'file:///documents/recordings/rec-partial.mov',
        stagingSourceUri: undefined,
        stagingSourceSize: undefined,
      }),
    ]);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///documents/recordings/rec-partial.mov',
      { idempotent: true },
    );
  });

  it('deletes both committed and pending manifests on explicit deletion', async () => {
    await deleteRecordingManifest('rec-1');
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///documents/recordings/rec-1.recording.0.json',
      { idempotent: true },
    );
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///documents/recordings/rec-1.recording.1.json.pending',
      { idempotent: true },
    );
  });

  it('uses deterministic pending and final privacy-blur paths', () => {
    expect(privacyBlurFileUris('rec-3')).toEqual({
      pendingUri: 'file:///documents/recordings/rec-3.privacy-blurred.pending.mp4',
      finalUri: 'file:///documents/recordings/rec-3.privacy-blurred.mp4',
      completionUri: 'file:///documents/recordings/rec-3.privacy-blurred.complete.json',
    });
  });

  it('removes partial, final, and completion privacy artifacts on explicit deletion', async () => {
    await deletePrivacyBlurArtifacts('rec-3');
    for (const uri of Object.values(privacyBlurFileUris('rec-3'))) {
      expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
    }
  });

  it('promotes a complete privacy-blurred file without touching the original', async () => {
    const finalUri = await promotePrivacyBlurredFile(
      'rec-4',
      'file:///documents/recordings/rec-4.privacy-blurred.pending.mp4',
    );
    expect(finalUri).toBe('file:///documents/recordings/rec-4.privacy-blurred.mp4');
    expect(FileSystem.moveAsync).toHaveBeenCalledWith({
      from: 'file:///documents/recordings/rec-4.privacy-blurred.pending.mp4',
      to: finalUri,
    });
  });
});
