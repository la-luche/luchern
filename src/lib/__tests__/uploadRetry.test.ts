import {
  OperationCancelledError,
  PollTimeoutError,
  cancellableDelay,
  classifyUploadError,
  UPLOAD_BACKOFFS_MS,
  createSerialQueue,
  uploadingCount,
} from '../uploadRetry';

describe('cancellableDelay', () => {
  afterEach(() => jest.useRealTimers());

  it('ends retry backoff immediately when logout aborts it', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const waiting = cancellableDelay(60_000, controller.signal);
    const assertion = expect(waiting).rejects.toBeInstanceOf(OperationCancelledError);

    controller.abort();

    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('classifyUploadError', () => {
  it('permanent for missing local file', () => {
    expect(classifyUploadError(new Error('recording file missing'))).toBe('permanent');
  });
  it('permanent for 413 too_large', () => {
    expect(classifyUploadError(new Error('POST /uploads/request-url → 413 {"error":"too_large"}'))).toBe('permanent');
  });
  it('retryable for a 403 expired presign', () => {
    expect(classifyUploadError(new Error('upload failed (403)'))).toBe('retryable');
  });
  it('retryable for a network error string', () => {
    expect(classifyUploadError(new Error('Network request failed'))).toBe('retryable');
  });
  it('retryable for a transient poll error whose trial id contains 413', () => {
    expect(classifyUploadError(new Error('GET /trials/41300 → 500 internal'))).toBe('retryable');
  });
  it('permanent for an upload-failed 413', () => {
    expect(classifyUploadError(new Error('upload failed (413)'))).toBe('permanent');
  });
});

describe('UPLOAD_BACKOFFS_MS', () => {
  it('is a strictly increasing 5-step schedule', () => {
    expect(UPLOAD_BACKOFFS_MS).toEqual([2000, 5000, 15000, 30000, 60000]);
  });
});

describe('createSerialQueue', () => {
  it('runs tasks one at a time in order', async () => {
    const enqueue = createSerialQueue();
    const events: string[] = [];
    const make = (name: string) => () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          events.push(name);
          resolve();
        }, 10),
      );
    await Promise.all([enqueue(make('a')), enqueue(make('b')), enqueue(make('c'))]);
    expect(events).toEqual(['a', 'b', 'c']);
  });
  it('starts the next task even if the previous rejected', async () => {
    const enqueue = createSerialQueue();
    const results: string[] = [];
    await enqueue(() => Promise.reject(new Error('boom'))).catch(() => results.push('failed'));
    await enqueue(() => Promise.resolve()).then(() => results.push('ran'));
    expect(results).toEqual(['failed', 'ran']);
  });
  it('PollTimeoutError is an Error with a name', () => {
    const e = new PollTimeoutError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('PollTimeoutError');
  });
});

describe('uploadingCount', () => {
  it('counts only uploading records', () => {
    expect(
      uploadingCount([
        { status: 'uploading' },
        { status: 'uploading' },
        { status: 'processing' },
        { status: 'done' },
        { status: 'failed' },
      ]),
    ).toBe(2);
  });
});
