import * as FileSystem from 'expo-file-system/legacy';

const RECORDINGS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}recordings/`
  : null;

function extensionFor(uri: string): string {
  const clean = uri.split(/[?#]/, 1)[0];
  const match = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
  const ext = match?.[1].toLowerCase();
  return ext === 'mov' || ext === 'm4v' || ext === 'mp4' ? ext : 'mp4';
}

/**
 * Camera recordings are created in the OS cache. Move them into the app's
 * documents directory before persisting their URI so low-storage cache cleanup
 * cannot silently break playback or a later upload.
 */
export async function persistRecordingFile(sourceUri: string, recordingId: string): Promise<string> {
  if (!RECORDINGS_DIR) throw new Error('recordings directory unavailable');

  await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
  const destination = `${RECORDINGS_DIR}${recordingId}.${extensionFor(sourceUri)}`;
  if (sourceUri === destination) return destination;

  try {
    // This is normally a cheap rename because both locations are in the app
    // container. Some providers cannot move directly, so retain a safe copy
    // fallback for device-specific URI behavior.
    await FileSystem.moveAsync({ from: sourceUri, to: destination });
  } catch {
    await FileSystem.copyAsync({ from: sourceUri, to: destination });
    try {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true });
    } catch (error) {
      // Never leave an untracked second copy in the camera cache. If cleanup
      // cannot be confirmed, discard the durable copy and fail the save.
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      throw error;
    }
  }
  return destination;
}

/** Delete an app-owned recording URI. Idempotent so retries and old cache URIs are safe. */
export async function deleteRecordingFile(uri: string): Promise<void> {
  if (!uri.startsWith('file://')) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

/** Destructive privacy boundary used by logout, including orphaned old files. */
export async function deleteAllRecordingFiles(): Promise<void> {
  if (!RECORDINGS_DIR) return;
  await FileSystem.deleteAsync(RECORDINGS_DIR, { idempotent: true });
}

/** Stable and temporary paths used by the native face-redaction encoder. */
export function faceBlurFileUris(recordingId: string): {
  pendingUri: string;
  finalUri: string;
} {
  if (!RECORDINGS_DIR) throw new Error('recordings directory unavailable');
  return {
    pendingUri: `${RECORDINGS_DIR}${recordingId}.face-blurred.pending.mp4`,
    finalUri: `${RECORDINGS_DIR}${recordingId}.face-blurred.mp4`,
  };
}

/**
 * Atomically promote a completed encoder output. The caller must persist this
 * URI before deleting the original recording.
 */
export async function promoteFaceBlurredFile(
  recordingId: string,
  pendingUri: string,
): Promise<string> {
  const { finalUri } = faceBlurFileUris(recordingId);
  await FileSystem.makeDirectoryAsync(RECORDINGS_DIR!, { intermediates: true });
  await FileSystem.deleteAsync(finalUri, { idempotent: true });
  await FileSystem.moveAsync({ from: pendingUri, to: finalUri });
  return finalUri;
}

export const __testing = { extensionFor };
