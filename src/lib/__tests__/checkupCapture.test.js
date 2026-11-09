import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
const React = require('react');
const { act, create } = require('react-test-renderer');
const { Alert } = require('react-native');
const { CameraView } = require('expo-camera');
const { ReviewPanel } = require('../../components/Capture');
const { Button } = require('../../components/Button');
const RecordScreen = require('../../app/record/[id]').default;
const BatteryReviewScreen = require('../../app/battery-review').default;
const { en } = require('../i18n/en');
const { startSession, endSession, advanceSession } = require('../session');
const { FULL_TEST_FLOW } = require('../tests');
const { setCaptureActive } = require('../captureActivity');

let mockParams, mockRecordings, mockFocused;
const mockRecord = jest.fn();
const mockStopRecording = jest.fn();
const mockStage = jest.fn();
const mockFinalize = jest.fn();
const mockRemove = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockDismissTo = jest.fn();
jest.mock('@clerk/clerk-expo', () => ({ useUser: () => ({ user: { id: 'owner' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-camera', () => ({
  CameraView: require('react').forwardRef((_, ref) => {
    require('react').useImperativeHandle(ref, () => ({ recordAsync: mockRecord, stopRecording: mockStopRecording }));
    return null;
  }),
  useCameraPermissions: () => [{ granted: true, status: 'granted' }, jest.fn(), jest.fn()],
}));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({}), VideoView: () => null }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'checkup-run' }));
jest.mock('expo-router', () => ({
  useFocusEffect: callback => require('react').useEffect(() => { if (mockFocused) return callback(); }, [callback, mockFocused]),
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace, push: mockPush, dismissTo: mockDismissTo }),
  Redirect: () => null,
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }) => children }));
jest.mock('../../components/Capture', () => ({ FramingGuide: () => null, ReviewPanel: () => null }));
jest.mock('../../components/RecordingThumbnail', () => ({ RecordingThumbnail: () => null }));
jest.mock('../../components/Header', () => ({ Header: () => null }));
jest.mock('../../components/Screen', () => ({ Screen: ({ children }) => children }));
jest.mock('../cues', () => ({ cues: { start: jest.fn(), stop: jest.fn(), saved: jest.fn() } }));
jest.mock('../captureActivity', () => ({ setCaptureActive: jest.fn() }));
jest.mock('../captureRecovery', () => ({ beginCaptureIntent: jest.fn(), attachCaptureOutput: jest.fn(), clearCaptureIntent: jest.fn() }));
jest.mock('../recordingFiles', () => ({ ensureFreeRecordingSpace: jest.fn() }));
jest.mock('../storage', () => ({ useRecordings: () => ({ recordings: mockRecordings, stageRecording: mockStage, finalizeRecording: mockFinalize, remove: mockRemove }) }));
jest.mock('../diagnostics', () => ({ diagnosticErrorData: () => ({}), recordDiagnostic: jest.fn() }));
jest.mock('../i18n', () => ({ useT: () => jest.requireActual('../i18n/en').en, formatEvaluatedSide: () => '' }));
jest.mock('../toast', () => ({ showToast: jest.fn() }));
let screen;
async function render(Component) { await act(async () => { screen = create(React.createElement(Component)); }); }
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'fingerTapping', guestId: 'guest' };
  mockRecordings = [];
  mockFocused = true;
  mockRecord.mockResolvedValue({ uri: 'file:///camera.mp4' });
  mockStage.mockResolvedValue({ id: 'new-clip', videoUri: 'file:///saved.mp4' });
  mockFinalize.mockResolvedValue({ id: 'new-clip', status: 'preparing' });
  startSession(FULL_TEST_FLOW);
});
afterEach(() => { if (screen) act(() => screen.unmount()); screen = undefined; endSession(); jest.restoreAllMocks(); });
async function recordClip() {
  await render(RecordScreen);
  act(() => screen.root.findByType(CameraView).props.onCameraReady());
  const start = screen.root.findAll(node => node.props.accessibilityLabel === en.record.startA11y && typeof node.props.onPress === 'function')[0];
  await act(async () => { await start.props.onPress(); });
}
it('stops and unmounts the camera when a notification covers the recording screen', async () => {
  await render(RecordScreen);
  expect(screen.root.findAllByType(CameraView)).toHaveLength(1);
  mockFocused = false;
  await act(async () => { screen.update(React.createElement(RecordScreen)); });
  expect(screen.root.findAllByType(CameraView)).toHaveLength(0);
  expect(mockStopRecording).toHaveBeenCalledTimes(1);
  expect(setCaptureActive).toHaveBeenLastCalledWith(false);
  mockFocused = true;
  await act(async () => { screen.update(React.createElement(RecordScreen)); });
  expect(screen.root.findAllByType(CameraView)).toHaveLength(1);
  expect(setCaptureActive).toHaveBeenLastCalledWith(true);
});
it('does not release another screen camera when a hidden capture finishes staging', async () => {
  let finishStage;
  mockStage.mockReturnValueOnce(new Promise(resolve => { finishStage = resolve; }));
  await render(RecordScreen);
  act(() => screen.root.findByType(CameraView).props.onCameraReady());
  const start = screen.root.findAll(node => node.props.accessibilityLabel === en.record.startA11y && typeof node.props.onPress === 'function')[0];
  let recording;
  await act(async () => { recording = start.props.onPress(); });
  expect(mockStage).toHaveBeenCalledTimes(1);
  mockFocused = false;
  await act(async () => { screen.update(React.createElement(RecordScreen)); });
  // A different recording screen now owns the global camera exclusion.
  setCaptureActive.mockClear();
  await act(async () => {
    finishStage({ id: 'new-clip', videoUri: 'file:///saved.mp4' });
    await recording;
  });
  expect(setCaptureActive).not.toHaveBeenCalled();
});
it('starts processing as soon as a checkup clip finishes, before Continue is pressed', async () => {
  await recordClip();
  expect(mockFinalize).toHaveBeenCalledWith('new-clip');
  expect(setCaptureActive).toHaveBeenLastCalledWith(false);
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => { await screen.root.findByType(ReviewPanel).props.onSubmit(); });
  expect(mockFinalize).toHaveBeenCalledWith('new-clip');
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/test/[id]', params: { id: 'fingerTapping', guestId: 'guest' } });
  expect(mockRemove).not.toHaveBeenCalled();
});
it('keeps and processes a checkup attempt when the user retakes it on the clip review', async () => {
  await recordClip();
  await act(async () => { await screen.root.findByType(ReviewPanel).props.onRetake(); });
  expect(mockFinalize).toHaveBeenCalledWith('new-clip');
  expect(mockRemove).not.toHaveBeenCalled();
  expect(screen.root.findAllByType(ReviewPanel)).toHaveLength(0);
  expect(setCaptureActive).toHaveBeenLastCalledWith(true);
  expect(mockReplace).not.toHaveBeenCalled();
});
it('ignores repeated acceptance taps while the clip is being committed', async () => {
  await recordClip();
  mockFinalize.mockClear();
  let finish;
  mockFinalize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const submit = screen.root.findByType(ReviewPanel).props.onSubmit;
  let first;
  act(() => { first = submit(); void submit(); });
  expect(mockFinalize).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ id: 'new-clip' }); await first; });
  expect(mockReplace).toHaveBeenCalledTimes(1);
});
it('opens a replacement capture without deleting the already-processing checkup video', async () => {
  // Capture the run identity through the same persisted staging contract.
  await recordClip();
  const run = mockStage.mock.calls[0][4];
  mockFinalize.mockClear();
  act(() => screen.unmount()); screen = undefined;
  mockRecordings = [{ id: 'old', testId: 'fingerTapping', evaluatedSide: 'left', guestId: 'guest', createdAt: 1, status: 'processing', jobId: '42', evaluationRun: run }];
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(BatteryReviewScreen);
  const rerecord = screen.root.findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'button')[0];
  act(() => rerecord.props.onPress());
  const choices = Alert.alert.mock.calls[0][2];
  expect(choices[1].style).not.toBe('destructive');
  act(() => choices[1].onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/test/[id]', params: { id: 'fingerTapping', side: 'left', batteryReview: '1', guestId: 'guest' } });
  expect(mockRemove).not.toHaveBeenCalled();
  const finish = screen.root.findAllByType(Button).find(button => button.props.title === en.batteryReview.sendRecorded);
  expect(finish.props.disabled).toBe(false);
  await act(async () => { await finish.props.onPress(); });
  expect(mockFinalize).not.toHaveBeenCalled();
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/checkups/[id]', params: { id: run.id, guestId: 'guest', patientId: '' } });
  expect(advanceSession()).toBeNull();
});
it('still waits for confirmation before processing an individual test', async () => {
  endSession();
  await recordClip();
  expect(mockFinalize).not.toHaveBeenCalled();
  await act(async () => { await screen.root.findByType(ReviewPanel).props.onRetake(); });
  expect(mockRemove).toHaveBeenCalledWith('new-clip');
});
it('keeps the checkup preview available if the initial commit needs a retry', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockFinalize.mockRejectedValueOnce(new Error('storage unavailable'));
  await recordClip();
  expect(screen.root.findByType(ReviewPanel)).toBeDefined();
  await act(async () => { await screen.root.findByType(ReviewPanel).props.onSubmit(); });
  expect(mockReplace).toHaveBeenCalledTimes(1);
  expect(mockRemove).not.toHaveBeenCalled();
});

it.each([
  ['pronationSupination', 10],
  ['restTremor', 20],
  ['fingerTapping', 120],
])('records %s with its timer target or manual-stop safety limit', async (id, seconds) => {
  mockParams = { id, guestId: 'guest' };
  await recordClip();
  expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ maxDuration: seconds }));
  expect(screen.root.findByType(ReviewPanel)).toBeDefined();
  expect(mockStage.mock.calls[0][0]).toBe(id);
});
