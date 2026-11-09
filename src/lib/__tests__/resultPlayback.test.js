import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
const React = require('react');
const { act, create } = require('react-test-renderer');
const { Linking } = require('react-native');
const { Button } = require('../../components/Button');
const { Header } = require('../../components/Header');
const { Redirect } = require('expo-router');
const { ResilientVideo } = require('../../components/ResilientVideo');
const ResultScreen = require('../../app/results/[id]').default;
const { en } = require('../i18n/en');
let mockRecording;
let mockParams;
const mockDismissTo = jest.fn();
const mockFetch = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ dismissTo: mockDismissTo }), Redirect: () => null }));
jest.mock('../../components/Header', () => ({ Header: () => null }));
jest.mock('../../components/Screen', () => ({ Screen: ({ children }) => children }));
jest.mock('../../components/StatusPill', () => ({ StatusPill: () => null }));
jest.mock('../../components/ResilientVideo', () => ({ ResilientVideo: () => null }));
jest.mock('../storage', () => ({ useRecordings: () => ({ recordings: mockRecording ? [mockRecording] : [], loading: false }) }));
jest.mock('../sharedRecordings', () => ({ fetchSharedTrialDetail: (...args) => mockFetch(...args) }));
jest.mock('../recordingFiles', () => ({ recordingExportTempUri: jest.fn() }));
jest.mock('../i18n', () => ({ useT: () => jest.requireActual('../i18n/en').en, formatEvaluatedSide: () => undefined, localizeSeverity: (_, label) => label, formatAnalysisFailureReason: (reason) => reason }));
let screen;
beforeEach(() => {
  mockParams = { id: 'test' };
  mockDismissTo.mockClear();
  mockRecording = { id: 'test', testId: 'fingerTapping', jobId: '42', status: 'needs_retry', analysisFailureReasons: ['low_coverage'], createdAt: Date.now() };
  mockFetch.mockReset().mockResolvedValue({ video_url: 'https://example.com/video.mp4' });
});
afterEach(() => { if (screen) act(() => screen.unmount()); screen = undefined; jest.restoreAllMocks(); });
async function render() { await act(async () => { screen = create(React.createElement(ResultScreen)); }); }
it('loads cloud-only rejected recordings without local privacy metadata and enables sharing', async () => {
  await render();
  expect(mockFetch).toHaveBeenCalledWith(42);
  expect(screen.root.findByType(ResilientVideo).props.uri).toBe('https://example.com/video.mp4');
  expect(screen.root.findAllByType(Button).find(b => b.props.title === en.result.shareWithDoctor).props.disabled).toBe(false);
});
it('shows a working methodology button when quality checks fail', async () => {
  jest.spyOn(Linking, 'openURL').mockResolvedValue();
  await render();
  const button = screen.root.findAllByType(Button).find(b => b.props.title === en.profile.scienceMethodology);
  act(() => button.props.onPress());
  expect(Linking.openURL).toHaveBeenCalledWith('https://luche.ai/methodology');
});
it('preserves local preview and blocks sanitized export while processing before upload', async () => {
  mockRecording = { ...mockRecording, jobId: undefined, status: 'preparing', videoUri: 'file:///original.mp4', privacyBlurState: 'processing' };
  await render();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(screen.root.findByType(ResilientVideo).props.uri).toBe('file:///original.mp4');
  expect(screen.root.findAllByType(Button).find(b => b.props.title === en.result.shareWithDoctor).props.disabled).toBe(true);
});
it('surfaces failed cloud loads and allows retry', async () => {
  mockFetch.mockRejectedValueOnce(new Error('offline'));
  await render();
  const retry = screen.root.findAllByType(Button).find(b => b.props.title === en.resultsList.tryAgain);
  await act(async () => retry.props.onPress());
  expect(screen.root.findByType(ResilientVideo).props.uri).toBe('https://example.com/video.mp4');
});
it('keeps completed local video playback without fetching the server', async () => {
  mockRecording = { ...mockRecording, privacyBlurState: 'completed', videoUri: 'file:///sanitized.mp4' };
  await render();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(screen.root.findByType(ResilientVideo).props.uri).toBe('file:///sanitized.mp4');
});
it.each(['', 'guest-1'])('returns to the selected history after opening its recording (%s)', async (guestId) => {
  mockParams = { id: 'test', guestId, fromHistory: '1' };
  mockRecording = { ...mockRecording, guestId: guestId || undefined, privacyBlurState: 'completed', videoUri: 'file:///sanitized.mp4' };
  await render();
  const back = screen.root.findAllByType(Button).find(b => b.props.title === en.people.backToHistory);
  act(() => back.props.onPress());
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/results', params: { guestId, patientId: '', section: 'tests' } });
});
it('returns to the containing checkup instead of the standalone test list', async () => {
  mockParams = { id: 'test', guestId: 'guest-1', fromHistory: '1', fromCheckup: 'run' };
  await render();
  const back = screen.root.findAllByType(Button).find(b => b.props.title === en.checkups.backToCheckup);
  act(() => back.props.onPress());
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/checkups/[id]', params: { id: 'run', guestId: 'guest-1', patientId: '' } });
});
it('returns to the filtered test-type page after viewing a recording', async () => {
  mockParams = { id: 'test', guestId: 'guest-1', fromHistory: '1', fromTestType: 'gait' };
  await render();
  const back = screen.root.findAllByType(Button).find(b => b.props.title === en.people.backToHistory);
  act(() => back.props.onPress());
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/results/test/[testId]', params: { testId: 'gait', guestId: 'guest-1', patientId: '' } });
});
it('returns a newly completed guest test to current history from either back control', async () => {
  mockParams = { id: 'test', guestId: 'guest-1', singleTestComplete: '1' };
  await render();
  const back = screen.root.findAllByType(Button).find(b => b.props.title === en.people.backToHistory);
  act(() => back.props.onPress());
  act(() => screen.root.findByType(Header).props.onBack());
  expect(mockDismissTo.mock.calls).toEqual(Array(2).fill([
    { pathname: '/results', params: { guestId: 'guest-1', patientId: '', section: 'tests' } },
  ]));
});
it('recovers a missing guest recording in current history', async () => {
  mockParams = { id: 'missing', guestId: 'guest-1' };
  mockRecording = null;
  await render();
  expect(screen.root.findByType(Redirect).props.href).toEqual({
    pathname: '/results', params: { guestId: 'guest-1', patientId: '', section: 'tests' },
  });
});
