import * as FileSystem from 'expo-file-system/legacy';

import { excludeFromBackupAsync } from '../../modules/face-blur';
import type { Recording } from './types';

const RECORDINGS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}recordings/`
  : null;
const EXPORTS_DIR = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}luche-recording-exports/`
  : null;

const MANIFEST_PATTERN = /\.recording\.[01]\.json(?:\.pending)?$/;
export const MIN_FREE_SPACE_BEFORE_RECORDING_BYTES = 1024 * 1024 * 1024;

type RecordingManifest = {
  version: 1;
  accountId: string;
  recording: Recording;
};

function extensionFor(uri: string): string {
  const clean = uri.split(/[?#]/, 1)[0];
  const match = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
  const ext = match?.[1].toLowerCase();
  return ext === 'mov' || ext === 'm4v' || ext === 'mp4' ? ext : 'mp4';
}

export function recordingFileUri(sourceUri: string, recordingId: string): string {
  if (!RECORDINGS_DIR) throw new Error('recordings directory unavailable');
  return `${RECORDINGS_DIR}${recordingId}.${extensionFor(sourceUri)}`;
}

export async function ensureFreeRecordingSpace(
  minimumBytes: number = MIN_FREE_SPACE_BEFORE_RECORDING_BYTES,
): Promise<void> {
  const freeBytes = await FileSystem.getFreeDiskStorageAsync();
  if (freeBytes < minimumBytes) {
    throw new Error('not enough free storage to safely record and de-identify another video');
  }
}

async function ensureRecordingDirectory(): Promise<void> {
  if (!RECORDINGS_DIR) throw new Error('recordings directory unavailable');
  await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
  await excludeFromBackupAsync(RECORDINGS_DIR);
}

export async function excludeRecordingsFromBackup(): Promise<void> {
  if (!RECORDINGS_DIR) return;
  const info = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (info.exists) await excludeFromBackupAsync(RECORDINGS_DIR);
}

/**
 * Camera recordings are created in the OS cache. Move them into the app's
 * documents directory before persisting their URI so low-storage cache cleanup
 * cannot silently break playback or a later upload.
 */
export async function persistRecordingFile(sourceUri: string, recordingId: string): Promise<string> {
  if (!RECORDINGS_DIR) throw new Error('recordings directory unavailable');

  await ensureRecordingDirectory();
  const destination = recordingFileUri(sourceUri, recordingId);
  const sourceInfo = await FileSystem.getInfoAsync(sourceUri);
  const sourceSize = sourceInfo.exists && 'size' in sourceInfo ? sourceInfo.size : undefined;
  if (!sourceInfo.exists || !sourceSize || sourceSize <= 0) {
    throw new Error('camera recording is missing or empty');
  }
  if (sourceUri === destination) return destination;

  try {
    // This is normally a cheap rename because both locations are in the app
    // container. Some providers cannot move directly, so retain a safe copy
    // fallback for device-specific URI behavior.
    await FileSystem.moveAsync({ from: sourceUri, to: destination });
  } catch {
    const copying = `${destination}.copying`;
    await FileSystem.deleteAsync(copying, { idempotent: true });
    await FileSystem.copyAsync({ from: sourceUri, to: copying });
    const copiedInfo = await FileSystem.getInfoAsync(copying);
    const copiedSize = copiedInfo.exists && 'size' in copiedInfo ? copiedInfo.size : undefined;
    if (!copiedInfo.exists || copiedSize !== sourceSize) {
      await FileSystem.deleteAsync(copying, { idempotent: true }).catch(() => {});
      throw new Error('durable recording copy is missing or incomplete');
    }
    await FileSystem.deleteAsync(destination, { idempotent: true });
    await FileSystem.moveAsync({ from: copying, to: destination });
    try {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true });
    } catch (error) {
      // Never leave an untracked second copy in the camera cache. If cleanup
      // cannot be confirmed, discard the durable copy and fail the save.
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      throw error;
    }
  }
  const destinationInfo = await FileSystem.getInfoAsync(destination);
  const destinationSize =
    destinationInfo.exists && 'size' in destinationInfo ? destinationInfo.size : undefined;
  if (!destinationInfo.exists || !destinationSize || destinationSize !== sourceSize) {
    throw new Error('durable recording copy is missing or incomplete');
  }
  await excludeFromBackupAsync(destination).catch(() => {});
  return destination;
}

/**
 * iOS may give the app a new absolute data-container prefix after an install.
 * AsyncStorage survives, but a persisted file:// URI can still point at the
 * old prefix. Rebind only app-owned recording paths whose file exists under
 * the current Documents directory; never guess or move user data.
 */
export async function rebindRecordingFileUri(uri?: string): Promise<string | undefined> {
  if (!uri?.startsWith('file://') || !RECORDINGS_DIR) return uri;
  const clean = uri.split(/[?#]/, 1)[0];
  const marker = '/recordings/';
  const markerIndex = clean.lastIndexOf(marker);
  if (markerIndex < 0) return uri;
  const filename = clean.slice(markerIndex + marker.length);
  if (!filename || filename.includes('/')) return uri;

  const currentUri = `${RECORDINGS_DIR}${filename}`;
  if (currentUri === uri) return uri;
  const info = await FileSystem.getInfoAsync(currentUri);
  return info.exists ? currentUri : uri;
}

export async function recordingFileExists(uri?: string): Promise<boolean> {
  if (!uri) return false;
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists;
}

export async function recordingFileSize(uri?: string): Promise<number | null> {
  if (!uri) return null;
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && 'size' in info && typeof info.size === 'number' ? info.size : null;
}

/**
 * Keep a tiny per-video recovery record beside the video itself. AsyncStorage
 * remains the fast index, but this prevents an AsyncStorage write failure or
 * corruption from orphaning an otherwise healthy recording on disk.
 */
export async function persistRecordingManifest(
  accountId: string,
  recording: Recording,
): Promise<void> {
  if (!RECORDINGS_DIR) throw new Error('recordings directory unavailable');
  await ensureRecordingDirectory();
  const slot = (recording.localRevision ?? 0) % 2;
  const finalUri = `${RECORDINGS_DIR}${recording.id}.recording.${slot}.json`;
  const pendingUri = `${finalUri}.pending`;
  const manifest: RecordingManifest = { version: 1, accountId, recording };
  await FileSystem.deleteAsync(pendingUri, { idempotent: true });
  await FileSystem.writeAsStringAsync(pendingUri, JSON.stringify(manifest));
  await FileSystem.deleteAsync(finalUri, { idempotent: true });
  await FileSystem.moveAsync({ from: pendingUri, to: finalUri });
  await excludeFromBackupAsync(finalUri).catch(() => {});
}

export async function readRecordingManifests(accountId: string): Promise<Recording[]> {
  if (!RECORDINGS_DIR) return [];
  const directory = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!directory.exists) return [];
  const filenames = await FileSystem.readDirectoryAsync(RECORDINGS_DIR);
  const newestById = new Map<string, Recording>();
  for (const filename of filenames) {
    if (!MANIFEST_PATTERN.test(filename)) continue;
    try {
      const raw = await FileSystem.readAsStringAsync(`${RECORDINGS_DIR}${filename}`);
      const parsed = JSON.parse(raw) as Partial<RecordingManifest>;
      if (
        parsed.version === 1 &&
        parsed.accountId === accountId &&
        parsed.recording &&
        typeof parsed.recording.id === 'string' &&
        typeof parsed.recording.testId === 'string' &&
        typeof parsed.recording.createdAt === 'number'
      ) {
        const recording = parsed.recording;
        recording.videoUri = await rebindRecordingFileUri(recording.videoUri);
        recording.originalVideoUri = await rebindRecordingFileUri(recording.originalVideoUri);
        recording.privacyBlurOriginalUri = await rebindRecordingFileUri(
          recording.privacyBlurOriginalUri,
        );
        const expectedSourceSize = recording.stagingSourceSize;
        const localSizes = await Promise.all([
          recordingFileSize(recording.videoUri),
          recordingFileSize(recording.originalVideoUri),
          recordingFileSize(recording.privacyBlurOriginalUri),
        ]);
        let hasLocalFile = localSizes.some((size) =>
          size != null && size > 0 && (expectedSourceSize == null || size === expectedSourceSize),
        );
        const stagingSize = await recordingFileSize(recording.stagingSourceUri);
        if (
          !hasLocalFile &&
          stagingSize != null &&
          stagingSize > 0 &&
          (expectedSourceSize == null || stagingSize === expectedSourceSize)
        ) {
          if (recording.videoUri && recording.videoUri !== recording.stagingSourceUri) {
            await deleteRecordingFile(recording.videoUri).catch(() => {});
          }
          const recoveredUri = await persistRecordingFile(
            recording.stagingSourceUri!,
            recording.id,
          );
          recording.videoUri = recoveredUri;
          recording.originalVideoUri = recoveredUri;
          recording.stagingSourceUri = undefined;
          recording.stagingSourceSize = undefined;
          hasLocalFile = true;
        }
        if (hasLocalFile) {
          recording.stagingSourceUri = undefined;
          recording.stagingSourceSize = undefined;
        }
        const current = newestById.get(recording.id);
        if (
          hasLocalFile &&
          (!current || (recording.localRevision ?? 0) > (current.localRevision ?? 0))
        ) {
          newestById.set(recording.id, recording);
        }
      }
    } catch {
      // A torn manifest is ignored; the durable AsyncStorage index remains the
      // primary copy and the video itself is never removed by recovery.
    }
  }
  return [...newestById.values()];
}

export async function deleteRecordingManifest(recordingId: string): Promise<void> {
  if (!RECORDINGS_DIR) return;
  await Promise.all(
    [0, 1].flatMap((slot) => {
      const finalUri = `${RECORDINGS_DIR}${recordingId}.recording.${slot}.json`;
      return [finalUri, `${finalUri}.pending`].map((uri) =>
        FileSystem.deleteAsync(uri, { idempotent: true }),
      );
    }),
  );
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

export async function recordingExportTempUri(filename: string): Promise<string | null> {
  if (!EXPORTS_DIR) return null;
  await FileSystem.makeDirectoryAsync(EXPORTS_DIR, { intermediates: true });
  return `${EXPORTS_DIR}${filename}`;
}

export async function clearRecordingExportTemps(): Promise<void> {
  if (!EXPORTS_DIR) return;
  await FileSystem.deleteAsync(EXPORTS_DIR, { idempotent: true });
}

export async function deletePrivacyBlurArtifacts(recordingId: string): Promise<void> {
  const { pendingUri, finalUri, completionUri } = privacyBlurFileUris(recordingId);
  await Promise.all(
    [pendingUri, finalUri, completionUri].map((uri) =>
      FileSystem.deleteAsync(uri, { idempotent: true }),
    ),
  );
}

/** Stable and temporary paths used by the native face-redaction encoder. */
export function privacyBlurFileUris(recordingId: string): {
  pendingUri: string;
  finalUri: string;
  completionUri: string;
} {
  if (!RECORDINGS_DIR) throw new Error('recordings directory unavailable');
  return {
    pendingUri: `${RECORDINGS_DIR}${recordingId}.privacy-blurred.pending.mp4`,
    finalUri: `${RECORDINGS_DIR}${recordingId}.privacy-blurred.mp4`,
    completionUri: `${RECORDINGS_DIR}${recordingId}.privacy-blurred.complete.json`,
  };
}

/**
 * Atomically promote a completed encoder output. The caller persists this URI
 * while retaining the original recording as local-only data.
 */
export async function promotePrivacyBlurredFile(
  recordingId: string,
  pendingUri: string,
): Promise<string> {
  const { finalUri, completionUri } = privacyBlurFileUris(recordingId);
  await ensureRecordingDirectory();
  await FileSystem.deleteAsync(completionUri, { idempotent: true });
  await FileSystem.deleteAsync(finalUri, { idempotent: true });
  await FileSystem.moveAsync({ from: pendingUri, to: finalUri });
  await excludeFromBackupAsync(finalUri).catch(() => {});
  return finalUri;
}

export const __testing = { extensionFor };
