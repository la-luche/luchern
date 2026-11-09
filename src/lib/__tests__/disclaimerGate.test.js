const React = require('react');
const { act, create } = require('react-test-renderer');
const { AppState, Modal, Text } = require('react-native');
const { DisclaimerGate } = require('../../components/DisclaimerGate');
const { Button } = require('../../components/Button');
const { en } = require('../i18n/en');

jest.mock('../i18n', () => ({ useT: () => jest.requireActual('../i18n/en').en }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }) => children }));

let screen;
let stateListeners;
let childMounts;
let childUnmounts;
function CurrentScreen() {
  const [value, setValue] = React.useState('Current task');
  React.useEffect(() => {
    childMounts += 1;
    return () => { childUnmounts += 1; };
  }, []);
  return React.createElement(Text, { onPress: () => setValue('Edited task') }, value);
}
function render() {
  act(() => { screen = create(React.createElement(DisclaimerGate, null, React.createElement(CurrentScreen))); });
}
function dismiss() {
  act(() => screen.root.findAllByType(Button).find(button => button.props.title === en.common.iUnderstand).props.onPress());
}
function visible() { return screen.root.findByType(Modal).props.visible; }
function appState(value) { act(() => { for (const listener of stateListeners) listener(value); }); }
beforeEach(() => {
  childMounts = 0;
  childUnmounts = 0;
  stateListeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    expect(event).toBe('change');
    stateListeners.add(listener);
    return { remove: () => stateListeners.delete(listener) };
  });
});
afterEach(() => {
  if (screen) act(() => screen.unmount());
  screen = undefined;
  jest.restoreAllMocks();
});

it('requires acknowledgement on each cold launch, even after a prior acknowledgement', () => {
  render();
  expect(visible()).toBe(true);
  expect(screen.root.findAll(node => node.props.accessibilityRole === 'radio')).toHaveLength(0);
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain(en.disclaimer.title);
  dismiss();
  expect(visible()).toBe(false);
  act(() => screen.unmount());
  render();
  expect(visible()).toBe(true);
});

it('stays dismissed after switching apps and preserves the current task', () => {
  render();
  dismiss();
  act(() => screen.root.findAllByType(Text).find(node => node.props.onPress).props.onPress());
  appState('background');
  appState('inactive');
  appState('active');
  expect(visible()).toBe(false);
  expect(childMounts).toBe(1);
  expect(childUnmounts).toBe(0);
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain('Edited task');
});

it('does not repeat for an inactive permission dialog or repeated active events', () => {
  render();
  dismiss();
  appState('inactive');
  appState('active');
  appState('active');
  expect(visible()).toBe(false);
});

it('keeps the warning acknowledged when the underlying screen changes', () => {
  render();
  dismiss();
  act(() => screen.update(React.createElement(DisclaimerGate, null, React.createElement(Text, null, 'Next screen'))));
  expect(visible()).toBe(false);
});

it('waits for acknowledgement rather than dismissing with Android Back', () => {
  render();
  act(() => screen.root.findByType(Modal).props.onRequestClose());
  expect(visible()).toBe(true);
  dismiss();
  expect(visible()).toBe(false);
});
