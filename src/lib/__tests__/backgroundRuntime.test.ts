const handlers: Record<string, (event: { sessionId: string; mode?: string }) => void> = {};
jest.mock('../../../modules/background-work', () => ({
  backgroundWork: {
    beginAsync: jest.fn().mockResolvedValue('continued'),
    endAsync: jest.fn().mockResolvedValue(undefined),
    updateAsync: jest.fn().mockResolvedValue(undefined),
    addListener: jest.fn((event, callback) => { handlers[event] = callback; return { remove() {} }; }),
  },
}));
jest.mock('../diagnostics', () => ({ recordDiagnostic: jest.fn(), diagnosticErrorData: () => ({}) }));

import { AppState } from 'react-native';
import { backgroundWork } from '../../../modules/background-work';
import { allowBackgroundWork, endBackgroundWork, ensureBackgroundWork, getBackgroundMode, isBackgroundWorkPaused, onBackgroundExpiration, updateBackgroundWork } from '../backgroundRuntime';

beforeEach(() => {
  endBackgroundWork(false);
  allowBackgroundWork();
  AppState.currentState = 'active';
  jest.clearAllMocks();
});

it('acquires one lease before the pipeline and retains it when another app opens', async () => {
  await Promise.all([ensureBackgroundWork(), ensureBackgroundWork()]);
  expect(backgroundWork!.beginAsync).toHaveBeenCalledTimes(1);
  expect(getBackgroundMode()).toBe('continued');
  AppState.currentState = 'background';
  await ensureBackgroundWork();
  updateBackgroundWork(0.6, 'Processing');
  expect(backgroundWork!.beginAsync).toHaveBeenCalledTimes(1);
  expect(backgroundWork!.updateAsync).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'Processing', 0.6);
});

it('honors OS expiration and will not restart until allowed after foregrounding', async () => {
  const expired = jest.fn();
  onBackgroundExpiration(expired);
  await ensureBackgroundWork();
  const id = (backgroundWork!.beginAsync as jest.Mock).mock.calls[0][0];
  handlers.onExpired({ sessionId: id });
  expect(isBackgroundWorkPaused()).toBe(true);
  expect(expired).toHaveBeenCalledTimes(1);
  await ensureBackgroundWork();
  expect(backgroundWork!.beginAsync).toHaveBeenCalledTimes(1);
  allowBackgroundWork();
  await ensureBackgroundWork();
  expect(backgroundWork!.beginAsync).toHaveBeenCalledTimes(2);
  handlers.onExpired({ sessionId: id });
  expect(isBackgroundWorkPaused()).toBe(false);
});

it('does not create a new foreground service or iOS continued task from a background retry', async () => {
  AppState.currentState = 'background';
  expect(await ensureBackgroundWork()).toBe('unavailable');
  expect(backgroundWork!.beginAsync).not.toHaveBeenCalled();
});

it('retries an unavailable lease on foreground without retaining the failed session', async () => {
  (backgroundWork!.beginAsync as jest.Mock).mockResolvedValueOnce('unavailable');
  expect(await ensureBackgroundWork()).toBe('unavailable');
  AppState.currentState = 'background';
  expect(await ensureBackgroundWork()).toBe('unavailable');
  AppState.currentState = 'active';
  allowBackgroundWork();
  expect(await ensureBackgroundWork()).toBe('continued');
  expect(backgroundWork!.beginAsync).toHaveBeenCalledTimes(2);
});

it('updates a late continued-task grant without accepting stale session events', async () => {
  (backgroundWork!.beginAsync as jest.Mock).mockResolvedValueOnce('limited');
  await ensureBackgroundWork();
  const id = (backgroundWork!.beginAsync as jest.Mock).mock.calls[0][0];
  expect(getBackgroundMode()).toBe('limited');
  handlers.onModeChanged({ sessionId: 'old', mode: 'continued' });
  expect(getBackgroundMode()).toBe('limited');
  handlers.onModeChanged({ sessionId: id, mode: 'continued' });
  expect(getBackgroundMode()).toBe('continued');
  expect(await ensureBackgroundWork()).toBe('continued');
});

it('does not clear a newer lease when a cancelled begin finally resolves', async () => {
  let resolve!: (value: string) => void;
  (backgroundWork!.beginAsync as jest.Mock).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const old = ensureBackgroundWork();
  endBackgroundWork(false);
  await ensureBackgroundWork();
  resolve('unavailable');
  await old;
  expect(getBackgroundMode()).toBe('continued');
  await ensureBackgroundWork();
  expect(backgroundWork!.beginAsync).toHaveBeenCalledTimes(2);
});
