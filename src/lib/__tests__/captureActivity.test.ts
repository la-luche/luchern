let change: (state: string) => void;
jest.mock('react-native', () => ({ AppState: {
  currentState: 'active',
  addEventListener: (_name: string, callback: (state: string) => void) => { change = callback; },
} }));
import { AppState } from 'react-native';
import { isCaptureActive, setCaptureActive, subscribeCaptureActivity } from '../captureActivity';

it('releases camera exclusion while hidden and restores it only if capture still wants the camera', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeCaptureActivity(listener);
  setCaptureActive(true);
  expect(isCaptureActive()).toBe(true);
  AppState.currentState = 'background';
  change('background');
  expect(isCaptureActive()).toBe(false);
  expect(listener).toHaveBeenLastCalledWith(false);
  AppState.currentState = 'active';
  change('active');
  expect(isCaptureActive()).toBe(true);
  setCaptureActive(false); // review or screen loses focus
  change('background');
  change('active');
  expect(isCaptureActive()).toBe(false);
  unsubscribe();
});
