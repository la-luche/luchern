const React = require('react');
const { act, create } = require('react-test-renderer');
const { BackHandler } = require('react-native');
const InstructionScreen = require('../../app/test/[id]').default;
const { startSession, endSession, useSession } = require('../session');
const { FULL_TEST_FLOW } = require('../tests');
const { en } = require('../i18n/en');
let mockParams, mockRecordings, session;
const mockBack = jest.fn();
const mockDismissTo = jest.fn();
const mockRouter = { back: mockBack, dismissTo: mockDismissTo };
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'partial-run' }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
  useFocusEffect: callback => require('react').useEffect(callback, [callback]),
  Redirect: () => null,
}));
jest.mock('../../components/Instruction', () => ({ DemoVideo: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }) => children }));
jest.mock('../storage', () => ({ useRecordings: ({ guestId }) => ({ recordings: mockRecordings.filter(r => r.guestId === guestId) }) }));
jest.mock('../i18n', () => ({ useT: () => jest.requireActual('../i18n/en').en, formatEvaluatedSide: () => '' }));
function Screen() { session = useSession(); return <InstructionScreen />; }
let screen;
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'fingerTapping', guestId: 'guest' };
  mockRecordings = [];
  startSession(FULL_TEST_FLOW);
  jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(() => { if (screen) act(() => screen.unmount()); screen = undefined; endSession(); jest.restoreAllMocks(); });
async function render() { await act(async () => { screen = create(<Screen />); }); }
function back() {
  screen.root.findAll(node => node.props.accessibilityLabel === en.common.back && typeof node.props.onPress === 'function')[0].props.onPress();
}

it.each(['button', 'android'])('opens the saved partial checkup on %s Back without waiting for processing', async control => {
  mockRecordings = [{ id: 'saved', guestId: 'guest', status: 'preparing', evaluationRun: { id: 'partial-run' } }];
  await render();
  act(() => {
    if (control === 'button') back();
    else expect(BackHandler.addEventListener.mock.calls.at(-1)[1]()).toBe(true);
  });
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/checkups/[id]', params: { id: 'partial-run', guestId: 'guest', patientId: '' } });
  expect(mockBack).not.toHaveBeenCalled();
  expect(session.active).toBe(false);
  expect(mockRecordings).toHaveLength(1);
});
it('does not create an empty checkup or use another person or run when leaving', async () => {
  mockRecordings = [{ guestId: 'other-person', evaluationRun: { id: 'partial-run' } }, { guestId: 'guest', evaluationRun: { id: 'other-run' } }];
  await render();
  act(back);
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(session.active).toBe(false);
});
it('keeps normal Back while reviewing a checkup retake', async () => {
  mockParams.batteryReview = '1';
  mockRecordings = [{ guestId: 'guest', evaluationRun: { id: 'partial-run' } }];
  await render();
  act(back);
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(session.active).toBe(true);
});
