jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  moveAsync: jest.fn().mockResolvedValue(undefined),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

import * as FileSystem from 'expo-file-system/legacy';
import {
  __testing,
  deleteRecordingFile,
  persistRecordingFile,
} from '../recordingFiles';

describe('recording file lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

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
  });

  it('falls back to copy plus cache cleanup when a direct move fails', async () => {
    (FileSystem.moveAsync as jest.Mock).mockRejectedValueOnce(new Error('provider move failed'));
    const uri = await persistRecordingFile('file:///cache/capture.mp4', 'rec-2');
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: 'file:///cache/capture.mp4',
      to: uri,
    });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///cache/capture.mp4',
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
});
