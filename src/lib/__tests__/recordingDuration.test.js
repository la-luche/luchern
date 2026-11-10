const React = require('react');
const { act, create } = require('react-test-renderer');
const { CameraView } = require('expo-camera');
const { RecordingOverlay } = require('../../components/RecordingOverlay');
const { ReviewPanel } = require('../../components/Capture');
const { cues } = require('../cues');
const RecordScreen = require('../../app/record/[id]').default;

let mockTestId;
let mockParams;
let mockSession;
const mockReplace = jest.fn();
const mockAdvance = jest.fn();
const mockRecord = jest.fn();
const mockStop = jest.fn();
const mockStage = jest.fn();
jest.mock('@clerk/clerk-expo', () => ({ useUser: () => ({ user: { id: 'owner' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-camera', () => ({
  CameraView: require('react').forwardRef((_, ref) => {
    require('react').useImperativeHandle(ref, () => ({ recordAsync: mockRecord, stopRecording: mockStop }));
    return null;
  }),
  useCameraPermissions: () => [{ granted: true, status: 'granted' }, jest.fn(), jest.fn()],
}));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockTestId, ...mockParams }),
  useRouter: () => ({ replace: mockReplace }),
  useFocusEffect: (callback) => require('react').useEffect(callback, [callback]),
  Redirect: () => null,
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }) => children }));
jest.mock('../../components/Capture', () => ({ ReviewPanel: () => null }));
jest.mock('../cues', () => ({ cues: { start: jest.fn(), stop: jest.fn() } }));
jest.mock('../captureActivity', () => ({ setCaptureActive: jest.fn() }));
jest.mock('../captureRecovery', () => ({ beginCaptureIntent: jest.fn(), attachCaptureOutput: jest.fn(), clearCaptureIntent: jest.fn() }));
jest.mock('../recordingFiles', () => ({ ensureFreeRecordingSpace: jest.fn() }));
jest.mock('../storage', () => ({ useRecordings: () => ({ stageRecording: mockStage }) }));
jest.mock('../session', () => ({ useSession: () => mockSession, advanceSession: () => mockAdvance() }));
jest.mock('../diagnostics', () => ({ diagnosticErrorData: () => ({}), recordDiagnostic: jest.fn() }));
jest.mock('../i18n', () => ({ useT: () => jest.requireActual('../i18n/en').en, formatEvaluatedSide: () => '' }));
jest.mock('../toast', () => ({ showToast: jest.fn() }));

let screen;
beforeEach(() => {
  jest.clearAllMocks();
  mockTestId = 'fingerTapping';
  mockParams = {};
  mockSession = { active: false };
  mockAdvance.mockReturnValue(null);
  mockRecord.mockResolvedValue({ uri: 'file:///camera.mp4' });
  mockStage.mockResolvedValue({ id: 'clip', videoUri: 'file:///saved.mp4' });
});

it('skips to the next checkup side once without creating a recording', async () => {
  mockParams = { guestId: 'guest', side: 'left' };
  mockSession = { active: true, current: { testId: 'fingerTapping', evaluatedSide: 'left' } };
  mockAdvance.mockReturnValue({ testId: 'fingerTapping', evaluatedSide: 'right' });
  await act(async () => { screen = create(<RecordScreen />); });
  const skip = screen.root.findByType(RecordingOverlay).props.onSkip;
  act(() => { skip(); skip(); });
  expect(mockAdvance).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/test/[id]', params: { id: 'fingerTapping', side: 'right', guestId: 'guest' },
  });
  expect(mockRecord).not.toHaveBeenCalled();
  expect(mockStage).not.toHaveBeenCalled();
});

it('opens checkup review after skipping the final step', async () => {
  mockTestId = 'gait';
  mockParams = { guestId: 'guest' };
  mockSession = { active: true, current: { testId: 'gait' } };
  await act(async () => { screen = create(<RecordScreen />); });
  act(() => screen.root.findByType(RecordingOverlay).props.onSkip());
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/battery-review', params: { guestId: 'guest' } });
});

it('does not skip while capture is starting or running', async () => {
  mockSession = { active: true, current: { testId: 'fingerTapping', evaluatedSide: 'left' } };
  let finish;
  mockRecord.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await act(async () => { screen = create(<RecordScreen />); });
  act(() => screen.root.findByType(CameraView).props.onCameraReady());
  const initial = screen.root.findByType(RecordingOverlay).props;
  await act(async () => { initial.onStart(); initial.onSkip(); });
  act(() => screen.root.findByType(RecordingOverlay).props.onSkip());
  expect(mockAdvance).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => { finish({ uri: 'file:///camera.mp4' }); });
});

it('does not advance the checkup from a review retake or a standalone test', async () => {
  await act(async () => { screen = create(<RecordScreen />); });
  expect(screen.root.findByType(RecordingOverlay).props.onSkip).toBeUndefined();
  mockSession = { active: true, current: { testId: 'fingerTapping', evaluatedSide: 'left' } };
  mockParams = { batteryReview: '1', side: 'left' };
  act(() => screen.update(<RecordScreen />));
  expect(screen.root.findByType(RecordingOverlay).props.onSkip).toBeUndefined();
  expect(mockAdvance).not.toHaveBeenCalled();
});
afterEach(() => { if (screen) act(() => screen.unmount()); screen = undefined; });
async function start() {
  await act(async () => { screen = create(<RecordScreen />); });
  act(() => screen.root.findByType(CameraView).props.onCameraReady());
  await act(async () => { screen.root.findByType(RecordingOverlay).props.onStart(); });
}

it.each([
  ['pronationSupination', 10], ['restTremor', 20], ['fingerTapping', 120],
])('uses the %s duration and stages the finished camera output', async (id, seconds) => {
  mockTestId = id;
  await start();
  expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ maxDuration: seconds }));
  expect(mockStage.mock.calls[0].slice(0, 2)).toEqual([id, 'file:///camera.mp4']);
  expect(screen.root.findByType(ReviewPanel).props.uri).toBe('file:///saved.mp4');
  expect(cues.stop).toHaveBeenCalledTimes(1);
});

it('plays the completion cue once when manually stopped before camera output resolves', async () => {
  let finish;
  mockRecord.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await start();
  act(() => screen.root.findByType(RecordingOverlay).props.onStop());
  expect(mockStop).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ uri: 'file:///camera.mp4' }); });
  expect(cues.stop).toHaveBeenCalledTimes(1);
  expect(screen.root.findByType(ReviewPanel)).toBeDefined();
});
