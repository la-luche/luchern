const React = require('react');
const { act, create } = require('react-test-renderer');
const { RecordingOverlay } = require('../../components/RecordingOverlay');
const { en } = require('../i18n/en');

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

it('uses the selected side for the guide while the record control remains available', () => {
  const onStart = jest.fn();
  render({ side: 'left', onStart });
  const image = screen.root.findByProps({ testID: 'recording-guide-fingerTapping' });
  expect(image.props.style).toContainEqual({ transform: [{ scaleX: -1 }] });
  const start = screen.root.findAll(node => node.props.accessibilityLabel === en.record.startA11y && typeof node.props.onPress === 'function')[0];
  act(() => start.props.onPress());
  expect(onStart).toHaveBeenCalledTimes(1);
});
