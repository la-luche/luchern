import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const React = require('react');
const { act, create } = require('react-test-renderer');
const { AppState, Linking } = require('react-native');
const { CameraView } = require('expo-camera');
const { Button } = require('../../components/Button');
const RecordScreen = require('../../app/record/[id]').default;

let mockPermission;
const mockRequestCamera = jest.fn();
const mockRefreshCamera = jest.fn();
const mockBack = jest.fn();

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
  MaterialCommunityIcons: () => null,
}));
jest.mock('@clerk/clerk-expo', () => ({ useUser: () => ({ user: { id: 'test-user' } }) }));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [mockPermission, mockRequestCamera, mockRefreshCamera],
}));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'fingerTapping' }),
  useRouter: () => ({ back: mockBack }),
  Redirect: () => null,
}));
jest.mock('../../components/Capture', () => ({ FramingGuide: () => null, ReviewPanel: () => null }));
jest.mock('../../components/Screen', () => ({ Screen: ({ children }) => children }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }) => children }));
jest.mock('../cues', () => ({ cues: {} }));
jest.mock('../captureActivity', () => ({ setCaptureActive: jest.fn() }));
jest.mock('../captureRecovery', () => ({
  attachCaptureOutput: jest.fn(), beginCaptureIntent: jest.fn(), clearCaptureIntent: jest.fn(),
}));
jest.mock('../i18n', () => ({
  useT: () => jest.requireActual('../i18n/en').en,
  formatEvaluatedSide: () => undefined,
}));
jest.mock('../diagnostics', () => ({ diagnosticErrorData: jest.fn(), recordDiagnostic: jest.fn() }));
jest.mock('../recordingFiles', () => ({ ensureFreeRecordingSpace: jest.fn() }));
jest.mock('../session', () => ({ useSession: () => ({ active: false }), advanceSession: jest.fn() }));
jest.mock('../storage', () => ({ useRecordings: () => ({}) }));
jest.mock('../toast', () => ({ showToast: jest.fn() }));

const undetermined = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };
const granted = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
const denied = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };

describe('recording camera permission', () => {
  let screen;
  let listeners;
  let removeListeners;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPermission = null;
    mockRequestCamera.mockImplementation(() => new Promise(() => {}));
    mockRefreshCamera.mockResolvedValue(denied);
    listeners = [];
    removeListeners = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
      if (event === 'change') listeners.push(listener);
      const remove = jest.fn();
      removeListeners.push(remove);
      return { remove };
    });
    jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  });

  afterEach(() => {
    if (screen) act(() => screen.unmount());
    screen = undefined;
    jest.restoreAllMocks();
  });

  function render() {
    act(() => {
      if (screen) screen.update(React.createElement(RecordScreen));
      else screen = create(React.createElement(RecordScreen));
    });
  }

  function buttonTitles() {
    return screen.root.findAllByType(Button).map((button) => button.props.title);
  }

  it('waits for the current permission without showing a custom permission message', () => {
    render();
    expect(mockRequestCamera).not.toHaveBeenCalled();
    expect(buttonTitles()).toEqual([]);
    expect(screen.root.findAllByType(CameraView)).toHaveLength(0);
    expect(JSON.stringify(screen.toJSON())).not.toContain('Camera access is off');
  });

  it('opens the system prompt once on first use, with no custom consent or Back button', () => {
    mockPermission = undetermined;
    render();
    render();
    expect(mockRequestCamera).toHaveBeenCalledTimes(1);
    expect(buttonTitles()).toEqual([]);
    expect(screen.root.findAllByType(CameraView)).toHaveLength(0);
    expect(JSON.stringify(screen.toJSON())).not.toContain('Camera access is off');
  });

  it('opens the preview after Allow without starting another request', () => {
    mockPermission = undetermined;
    render();
    mockPermission = granted;
    render();
    expect(screen.root.findAllByType(CameraView)).toHaveLength(1);
    expect(buttonTitles()).toEqual([]);
    expect(mockRequestCamera).toHaveBeenCalledTimes(1);
  });

  it('offers Settings and Back after Don’t Allow', async () => {
    mockPermission = undetermined;
    render();
    mockPermission = denied;
    render();
    expect(buttonTitles()).toEqual(['Open Settings', 'Back']);
    expect(screen.root.findAllByType(CameraView)).toHaveLength(0);
    const buttons = screen.root.findAllByType(Button);
    await act(async () => { await buttons[0].props.onPress(); });
    act(() => buttons[1].props.onPress());
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockRequestCamera).toHaveBeenCalledTimes(1);
  });

  it.each([denied, { ...denied, canAskAgain: true }])(
    'respects a previous denial even when the OS permits another request (%j)',
    (permission) => {
      mockPermission = permission;
      render();
      expect(mockRequestCamera).not.toHaveBeenCalled();
      expect(buttonTitles()).toEqual(['Open Settings', 'Back']);
    },
  );

  it('shows the camera immediately when permission was already granted', () => {
    mockPermission = granted;
    render();
    expect(mockRequestCamera).not.toHaveBeenCalled();
    expect(screen.root.findAllByType(CameraView)).toHaveLength(1);
  });

  it('refreshes on return from Settings and shows the preview if access was enabled', async () => {
    mockPermission = denied;
    render();
    await act(async () => listeners.forEach((listener) => listener('background')));
    expect(mockRefreshCamera).not.toHaveBeenCalled();
    mockRefreshCamera.mockImplementation(async () => {
      mockPermission = granted;
      return granted;
    });
    await act(async () => listeners.forEach((listener) => listener('active')));
    render();
    expect(mockRefreshCamera).toHaveBeenCalledTimes(1);
    expect(mockRequestCamera).not.toHaveBeenCalled();
    expect(screen.root.findAllByType(CameraView)).toHaveLength(1);
    act(() => screen.unmount());
    screen = undefined;
    removeListeners.forEach((remove) => expect(remove).toHaveBeenCalledTimes(1));
  });

  it('lets the user leave if the native permission request fails', async () => {
    mockPermission = undetermined;
    mockRequestCamera.mockRejectedValue(new Error('native camera unavailable'));
    await act(async () => { render(); });
    expect(buttonTitles()).toEqual(['Back']);
    expect(JSON.stringify(screen.toJSON())).toContain('Camera unavailable');
    expect(mockRequestCamera).toHaveBeenCalledTimes(1);
  });
});
