const React = require('react');
const { act, create } = require('react-test-renderer');
const { CameraView } = require('expo-camera');
const { RecordingOverlay } = require('../../components/RecordingOverlay');
const { ReviewPanel } = require('../../components/Capture');
const { cues } = require('../cues');
const RecordScreen = require('../../app/record/[id]').default;

let mockTestId;
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
  useLocalSearchParams: () => ({ id: mockTestId }),
  useRouter: () => ({}),
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
jest.mock('../session', () => ({ useSession: () => ({ active: false }) }));
jest.mock('../diagnostics', () => ({ diagnosticErrorData: () => ({}), recordDiagnostic: jest.fn() }));
jest.mock('../i18n', () => ({ useT: () => jest.requireActual('../i18n/en').en, formatEvaluatedSide: () => '' }));
jest.mock('../toast', () => ({ showToast: jest.fn() }));

let screen;
beforeEach(() => {
  jest.clearAllMocks();
  mockTestId = 'fingerTapping';
  mockRecord.mockResolvedValue({ uri: 'file:///camera.mp4' });
  mockStage.mockResolvedValue({ id: 'clip', videoUri: 'file:///saved.mp4' });
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
