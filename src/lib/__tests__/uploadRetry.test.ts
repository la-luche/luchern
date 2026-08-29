import {
  OperationCancelledError,
  PollTimeoutError,
  cancellableDelay,
  classifyUploadError,
  UPLOAD_BACKOFFS_MS,
  createConcurrencyQueue,
  selectPipelineBatch,
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

describe('createConcurrencyQueue', () => {
  it('never runs more than the configured number of tasks', async () => {
    const enqueue = createConcurrencyQueue(3);
    let active = 0;
    let peak = 0;
    const task = () => enqueue(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });

    await Promise.all(Array.from({ length: 100 }, task));

    expect(peak).toBe(3);
  });
});

describe('selectPipelineBatch', () => {
  it('admits a bounded active set from a 1,200-recording reconnect backlog', () => {
    const now = Date.now();
    const records = Array.from({ length: 1200 }, (_, index) => ({
      id: `r-${index}`,
      status: index < 600 ? 'uploading' : 'processing',
      createdAt: index,
      privacyBlurState: 'completed',
      ...(index >= 600 ? { jobId: `job-${index}`, nextPollAt: 0 } : {}),
    }));

    const selected = selectPipelineBatch(records, {
      activeIds: new Set(),
      ingestSlots: 2,
      pollSlots: 4,
      now,
      privacyAllowed: true,
    });

    expect(selected.ingestIds).toHaveLength(2);
    expect(selected.pollIds).toHaveLength(4);
    expect(new Set([...selected.ingestIds, ...selected.pollIds]).size).toBe(6);
  });

  it('does not start privacy processing while the camera is active', () => {
    const selected = selectPipelineBatch(
      [{
        id: 'privacy-1',
        status: 'preparing',
        createdAt: 1,
        privacyBlurState: 'pending',
      }],
      {
        activeIds: new Set(),
        ingestSlots: 2,
        pollSlots: 4,
        now: Date.now(),
        privacyAllowed: false,
      },
    );

    expect(selected).toEqual({ ingestIds: [], pollIds: [] });
  });

  it('gives every large-backlog job a first poll before recycling older jobs', () => {
    const records = Array.from({ length: 1200 }, (_, index) => ({
      id: `r-${index}`,
      status: 'processing',
      createdAt: index,
      jobId: `job-${index}`,
      nextPollAt: 0,
    }));
    const seen = new Set<string>();
    let now = 1;
    for (let cycle = 0; cycle < 300; cycle += 1) {
      const selected = selectPipelineBatch(records, {
        activeIds: new Set(),
        ingestSlots: 0,
        pollSlots: 4,
        now,
        privacyAllowed: true,
      });
      for (const id of selected.pollIds) {
        seen.add(id);
        const record = records.find((item) => item.id === id)!;
        record.nextPollAt = now + 5000;
      }
      now += 100;
    }
    expect(seen.size).toBe(1200);
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
