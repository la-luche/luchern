/**
 * Pure, React-Native-free helpers for the upload lifecycle so they can be unit
 * tested without RN mocks. storage.ts wires these to AsyncStorage + drive().
 */

/** Thrown by cloud.ts when the client poll ceiling is reached. NOT a real
 *  failure — the server worker may still finish, so drive() keeps the record
 *  in 'processing' to be re-polled on the next launch. */
export class PollTimeoutError extends Error {
  constructor(message = 'analysis poll timed out') {
    super(message);
    this.name = 'PollTimeoutError';
  }
}

/** 'permanent' failures are pointless to retry (file gone, over size cap);
 *  everything else is a transient/network condition worth retrying. */
export function classifyUploadError(e: unknown): 'retryable' | 'permanent' {
  const msg = e instanceof Error ? e.message : String(e);
  if (
    msg.includes('recording file missing') ||
    msg.includes('too_large') ||
    msg.includes('(413)') ||
    msg.includes('→ 413')
  ) {
    return 'permanent';
  }
  return 'retryable';
}

/** In-session backoff schedule (ms). Length = number of retries after the
 *  first attempt. A retry naturally mints a fresh presigned URL, fixing an
 *  expired-TTL 403. */
export const UPLOAD_BACKOFFS_MS: number[] = [2000, 5000, 15000, 30000, 60000];

/** Single-slot FIFO queue: one task runs at a time; the next starts after the
 *  previous settles (success OR failure). Used to serialize byte-uploads so
 *  they don't compete on a weak uplink. */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** How many recordings are actively in the byte-upload phase (drives the
 *  banner count). */
export function uploadingCount(recordings: { status: string }[]): number {
  return recordings.filter((r) => r.status === 'uploading').length;
}
