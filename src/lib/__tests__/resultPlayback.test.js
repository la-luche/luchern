import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
const React = require('react');
const { act, create } = require('react-test-renderer');
const { Linking } = require('react-native');
const { Button } = require('../../components/Button');
const { ResilientVideo } = require('../../components/ResilientVideo');
const ResultScreen = require('../../app/results/[id]').default;
const { en } = require('../i18n/en');
let mockRecording;
const mockFetch = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'test' }), useRouter: () => ({}), Redirect: () => null }));
jest.mock('../../components/Header', () => ({ Header: () => null }));
jest.mock('../../components/Screen', () => ({ Screen: ({ children }) => children }));
jest.mock('../../components/StatusPill', () => ({ StatusPill: () => null }));
jest.mock('../../components/ResilientVideo', () => ({ ResilientVideo: () => null }));
jest.mock('../storage', () => ({ useRecordings: () => ({ recordings: [mockRecording], loading: false }) }));
jest.mock('../sharedRecordings', () => ({ fetchSharedTrialDetail: (...args) => mockFetch(...args) }));
jest.mock('../recordingFiles', () => ({ recordingExportTempUri: jest.fn() }));
jest.mock('../i18n', () => ({ useT: () => jest.requireActual('../i18n/en').en, formatEvaluatedSide: () => undefined, localizeSeverity: (_, label) => label, formatAnalysisFailureReason: (reason) => reason }));
let screen;
beforeEach(() => {
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
