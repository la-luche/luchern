import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';

const React = require('react');
const { act, create } = require('react-test-renderer');
const { Text } = require('react-native');
const { activateKeepAwakeAsync, deactivateKeepAwake } = require('expo-keep-awake');
const { TopBanners } = require('../../components/OfflineBanner');
const { en } = require('../i18n/en');

let mockSegments;
let mockParams;
let mockRecordings;
let mockNetwork;
const mockPush = jest.fn();
const mockRetry = jest.fn();
const mockRetryPrivacy = jest.fn();
jest.mock('expo-router', () => ({
  useSegments: () => mockSegments,
  useGlobalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('expo-network', () => ({ useNetworkState: () => mockNetwork }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(), deactivateKeepAwake: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44 }) }));
jest.mock('../storage', () => ({ useRecordings: () => ({ recordings: mockRecordings, retry: mockRetry, retryPrivacyBlurring: mockRetryPrivacy }) }));
jest.mock('../i18n', () => ({ useT: () => jest.requireActual('../i18n/en').en, useLang: () => ({ lang: 'en' }) }));

let screen;
function render() {
  act(() => {
    if (screen) screen.update(React.createElement(TopBanners));
    else screen = create(React.createElement(TopBanners));
  });
}
function bannerButtons() { return screen.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'); }
function pressBanner() { act(() => bannerButtons()[0].props.onPress()); }
beforeEach(() => {
  jest.clearAllMocks();
  mockSegments = [];
  mockParams = {};
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockRecordings = [{ id: 'clip', status: 'preparing', privacyBlurProgress: 0.5 }];
});
afterEach(() => {
  if (screen) act(() => screen.unmount());
  screen = undefined;
  jest.useRealTimers();
});

it.each(['preparing', 'uploading', 'failed', 'blur_failed'])('does not reopen the current guest result from a %s banner', (status) => {
  mockSegments = ['results', '[id]'];
  mockParams = { id: 'clip', guestId: 'guest-1', fromHistory: '1', fromCheckup: 'run' };
  mockRecordings = [{ id: 'clip', guestId: 'guest-1', status, resumable: true }];
  render();
  pressBanner();
  pressBanner();
  expect(mockPush).not.toHaveBeenCalled();
});
it('does not reopen the current personal result when the guest scope is empty', () => {
  mockSegments = ['results', '[id]'];
  mockParams = { id: 'clip', guestId: '', singleTestComplete: '1' };
  render();
  pressBanner();
  expect(mockPush).not.toHaveBeenCalled();
});
it('opens a different pending result and stops navigating once it is on screen', () => {
  mockSegments = ['results', '[id]'];
  mockParams = { id: 'other-clip', guestId: 'guest-2' };
  mockRecordings[0].guestId = 'guest-1';
  render();
  pressBanner();
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/results/[id]', params: { id: 'clip', guestId: 'guest-1' } });
  mockParams = { id: 'clip', guestId: 'guest-1' };
  render();
  pressBanner();
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it.each(['', 'guest-1'])('opens current history for a pending batch owned by one person (%s)', (guestId) => {
  mockRecordings = ['one', 'two'].map(id => ({ id, guestId, status: 'uploading' }));
  render();
  pressBanner();
  const params = { guestId, patientId: '', section: 'tests' };
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/results', params });
  mockSegments = ['results'];
  mockParams = params;
  render();
  pressBanner();
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it('opens the current people picker for a mixed batch without reopening it', () => {
  mockRecordings.push({ id: 'guest-clip', guestId: 'guest-1', status: 'preparing' });
  render();
  pressBanner();
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/people', params: { mode: 'history' } });
  mockSegments = ['people'];
  mockParams = { mode: 'history' };
  render();
  pressBanner();
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it('hides both status bars on the camera screen and restores them afterward without stopping background work', () => {
  jest.useFakeTimers();
  mockNetwork = { isConnected: false, isInternetReachable: false };
  render();
  act(() => jest.advanceTimersByTime(1500));
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain(en.offline.message);
  expect(bannerButtons().length).toBeGreaterThan(0);
  expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);

  mockSegments = ['record', '[id]'];
  mockParams = { id: 'fingerTapping' };
  render();
  expect(screen.toJSON()).toBeNull();
  expect(deactivateKeepAwake).not.toHaveBeenCalled();

  mockSegments = ['results', '[id]'];
  mockParams = { id: 'clip' };
  render();
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain(en.offline.message);
  expect(bannerButtons().length).toBeGreaterThan(0);
  expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
});
