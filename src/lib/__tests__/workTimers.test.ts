import { clearWorkTimeout, flushWorkTimers, setWorkTimeout } from '../workTimers';
import { cancellableDelay } from '../uploadRetry';

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1000); });
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

it('fires from a native tick when JS timers did not advance and fires only once', () => {
  const callback = jest.fn();
  setWorkTimeout(callback, 5000);
  jest.setSystemTime(6000);
  expect(callback).not.toHaveBeenCalled();
  flushWorkTimers();
  expect(callback).toHaveBeenCalledTimes(1);
  jest.runAllTimers();
  flushWorkTimers();
  expect(callback).toHaveBeenCalledTimes(1);
});

it('does not revive a cleared timeout or an aborted retry on the next native tick', async () => {
  const callback = jest.fn();
  clearWorkTimeout(setWorkTimeout(callback, 100));
  const controller = new AbortController();
  const delay = cancellableDelay(100, controller.signal);
  controller.abort();
  await expect(delay).rejects.toThrow('cancelled');
  jest.setSystemTime(5000);
  flushWorkTimers();
  expect(callback).not.toHaveBeenCalled();
});
