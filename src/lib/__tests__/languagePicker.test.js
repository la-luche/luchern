const React = require('react');
const { act, create } = require('react-test-renderer');
const { Modal, Text } = require('react-native');
const AsyncStorage = require('@react-native-async-storage/async-storage');
const { LanguageProvider, useLang, useT } = require('../i18n');
const { LanguageList, LanguagePicker } = require('../../components/LanguagePicker');
const { LanguageSetupGate } = require('../../components/LanguageSetupGate');
const { DisclaimerGate } = require('../../components/DisclaimerGate');
const { Button } = require('../../components/Button');
const { es } = require('../i18n/es');
const { zh } = require('../i18n/zh');
const { ru } = require('../i18n/ru');

let mockDeviceLanguage = 'en';
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: mockDeviceLanguage }] }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }) => children }));

let screen;
let language;
function Content() {
  language = useLang();
  const t = useT();
  return React.createElement(React.Fragment, null,
    React.createElement(LanguagePicker),
    React.createElement(Text, null, t.menu.startFullCheck),
  );
}
function SetupContent() {
  language = useLang();
  return React.createElement(LanguageSetupGate, null,
    React.createElement(DisclaimerGate, null, React.createElement(Text, null, 'App content')));
}
async function render(Component = Content) {
  await act(async () => { screen = create(React.createElement(LanguageProvider, null, React.createElement(Component))); });
}
function open() {
  const control = screen.root.findAll(node => node.props.accessibilityRole === 'button'
    && node.props.accessibilityState?.expanded === false && typeof node.props.onPress === 'function')[0];
  act(() => control.props.onPress());
}
function choose(label) {
  const control = screen.root.findAll(node => node.props.accessibilityRole === 'radio'
    && node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  act(() => control.props.onPress());
}
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockDeviceLanguage = 'en';
});
afterEach(() => {
  if (screen) act(() => screen.unmount());
  screen = undefined;
  jest.restoreAllMocks();
});

it('offers five languages in a list and persists a Spanish selection', async () => {
  await render();
  open();
  const labels = [...new Set(screen.root.findAll(node => node.props.accessibilityRole === 'radio').map(node => node.props.accessibilityLabel))];
  expect(labels).toEqual(['English', 'Español', 'Italiano', 'Русский', '简体中文']);
  choose('Español');
  expect(language.lang).toBe('es');
  expect(screen.root.findByType(Modal).props.visible).toBe(false);
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain(es.menu.startFullCheck);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('luche.lang.v1', 'es');
});

it('uses Chinese for a Chinese device and restores a saved language on the next launch', async () => {
  mockDeviceLanguage = 'zh';
  await render();
  expect(language.lang).toBe('zh');
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain(zh.menu.startFullCheck);
  act(() => screen.unmount());
  await AsyncStorage.setItem('luche.lang.v1', 'es');
  await render();
  expect(language.lang).toBe('es');
});

it('keeps a user selection when an older saved preference finishes loading later', async () => {
  let finish;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  open();
  choose('简体中文');
  await act(async () => finish('it'));
  expect(language.lang).toBe('zh');
});

it('cancel and Android Back close the list without changing the language', async () => {
  await render();
  open();
  act(() => screen.root.findByType(Button).props.onPress());
  expect(screen.root.findByType(Modal).props.visible).toBe(false);
  open();
  act(() => screen.root.findByType(Modal).props.onRequestClose());
  expect(screen.root.findByType(Modal).props.visible).toBe(false);
  expect(language.lang).toBe('en');
});

it('falls back to English for unsupported device and stored languages', async () => {
  mockDeviceLanguage = 'de';
  await AsyncStorage.setItem('luche.lang.v1', 'unknown');
  await render();
  expect(language.lang).toBe('en');
});

it('asks for language before the first warning and only shows the warning on later launches', async () => {
  await render(SetupContent);
  expect(screen.root.findAllByType(LanguageList)).toHaveLength(1);
  expect(screen.root.findAllByType(DisclaimerGate)).toHaveLength(0);
  choose('Español');
  expect(screen.root.findAllByType(LanguageList)).toHaveLength(0);
  expect(screen.root.findAllByType(LanguagePicker)).toHaveLength(0);
  expect(screen.root.findByType(Modal).props.visible).toBe(true);
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain(es.disclaimer.body2);
  act(() => screen.root.findByType(Button).props.onPress());
  expect(screen.root.findByType(Modal).props.visible).toBe(false);
  act(() => screen.unmount());
  await render(SetupContent);
  expect(language.lang).toBe('es');
  expect(screen.root.findAllByType(LanguageList)).toHaveLength(0);
  expect(screen.root.findByType(Modal).props.visible).toBe(true);
});

it('waits for an existing language choice without flashing selection or a warning in the wrong language', async () => {
  let finish;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(SetupContent);
  expect(screen.root.findAllByType(LanguageList)).toHaveLength(0);
  expect(screen.root.findAllByType(DisclaimerGate)).toHaveLength(0);
  await act(async () => finish('ru'));
  expect(screen.root.findAllByType(LanguageList)).toHaveLength(0);
  expect(screen.root.findAllByType(Text).map(node => node.props.children)).toContain(ru.disclaimer.body2);
});

it('lets first-launch setup continue if the saved preference cannot be read', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage unavailable'));
  await render(SetupContent);
  choose('English');
  expect(screen.root.findAllByType(LanguageList)).toHaveLength(0);
  expect(screen.root.findByType(Modal).props.visible).toBe(true);
});
