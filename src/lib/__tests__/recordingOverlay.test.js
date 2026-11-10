const React = require('react');
const { act, create } = require('react-test-renderer');
const { RecordingOverlay } = require('../../components/RecordingOverlay');
const { en } = require('../i18n/en');
const { RECORDING_TARGETS } = require('../recordingGuide');

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicon' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }) => children }));

const noop = () => {};
const defaults = {
  testId: 'fingerTapping', t: en, recording: false, elapsed: 0,
  cameraReady: true, facing: 'back', torch: false, zoom: 0,
  onBack: noop, onFlash: noop, onFlip: noop, onZoom: noop, onStart: noop, onStop: noop,
};
let screen;
function render(props) { act(() => { screen = create(<RecordingOverlay {...defaults} {...props} />); }); }
afterEach(() => { if (screen) act(() => screen.unmount()); screen = undefined; });

it('keeps the same regular flash glyph and disables camera changes during recording', () => {
  render({ recording: true, torch: true });
  expect(screen.root.findByProps({ testID: 'recording-flash' }).props.disabled).toBe(true);
  expect(screen.root.findByProps({ testID: 'recording-flip' }).props.disabled).toBe(true);
  const names = screen.root.findAllByType('Ionicon').map(node => node.props.name);
  expect(names).toContain('flash-outline');
  expect(names).toContain('camera-reverse-outline');
  expect(names).not.toContain('flash-off');
});

it('counts timed tasks down without pretending to detect completed repetitions', () => {
  render({ testId: 'pronationSupination', recording: true, elapsed: 4 });
  expect(screen.root.findByProps({ testID: 'recording-target' }).props.children).toBe('6 sec');
  act(() => screen.update(<RecordingOverlay {...defaults} testId="restTremor" recording elapsed={25} />));
  expect(screen.root.findByProps({ testID: 'recording-target' }).props.children).toBe('0 sec');
  act(() => screen.update(<RecordingOverlay {...defaults} recording elapsed={4} />));
  expect(screen.root.findByProps({ testID: 'recording-target' }).props.children).toBe('30 taps');
});

it.each(Object.keys(RECORDING_TARGETS))('keeps the target without the elapsed badge for %s', (testId) => {
  render({ testId, recording: true, elapsed: 7 });
  expect(screen.root.findAllByProps({ testID: 'recording-elapsed' })).toHaveLength(0);
  const target = RECORDING_TARGETS[testId];
  expect(screen.root.findByProps({ testID: 'recording-target' }).props.children)
    .toBe(en.record.target[target.unit](target.unit === 'seconds' ? target.count - 7 : target.count));
});

it('offers Skip for a checkup and disables it while recording', () => {
  const onSkip = jest.fn();
  render({ onSkip });
  const button = screen.root.findByProps({ testID: 'recording-skip' });
  expect(button.props.accessibilityLabel).toBe(en.session.skip);
  act(() => button.props.onPress());
  expect(onSkip).toHaveBeenCalledTimes(1);
  act(() => screen.update(<RecordingOverlay {...defaults} onSkip={onSkip} recording />));
  expect(screen.root.findByProps({ testID: 'recording-skip' }).props.disabled).toBe(true);
  act(() => screen.update(<RecordingOverlay {...defaults} />));
  expect(screen.root.findAllByProps({ testID: 'recording-skip' })).toHaveLength(0);
});

it('uses the selected side for the guide while the record control remains available', () => {
  const onStart = jest.fn();
  render({ side: 'left', onStart });
  const image = screen.root.findByProps({ testID: 'recording-guide-fingerTapping' });
  expect(image.props.style).toContainEqual({ transform: [{ scaleX: -1 }] });
  const start = screen.root.findAll(node => node.props.accessibilityLabel === en.record.startA11y && typeof node.props.onPress === 'function')[0];
  act(() => start.props.onPress());
  expect(onStart).toHaveBeenCalledTimes(1);
});
