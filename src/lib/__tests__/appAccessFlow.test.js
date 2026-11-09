const React = require('react');
const { create, act } = require('react-test-renderer');
const { Text, TextInput } = require('react-native');
const { AuthGate } = require('../../components/AuthGate');
const { AppAccessGate } = require('../../components/AppAccessGate');
const { Button } = require('../../components/Button');
const { en } = require('../i18n/en');

let mockAuth;
let mockNetwork;
const mockSignOut = jest.fn();
const mockSetActive = jest.fn();
const mockRequest = jest.fn();
const mockMyAccess = jest.fn();
const mockCached = jest.fn();
const mockRemember = jest.fn();
const mockForget = jest.fn();
const mockOnboard = jest.fn();
const mockSignIn = { create: jest.fn(), prepareFirstFactor: jest.fn(), attemptFirstFactor: jest.fn() };
const mockSignUp = { create: jest.fn(), prepareEmailAddressVerification: jest.fn(), attemptEmailAddressVerification: jest.fn() };
jest.mock('@clerk/clerk-expo', () => ({
  useAuth: () => ({ ...mockAuth, signOut: mockSignOut }),
  useClerk: () => ({ setActive: mockSetActive }),
  useSignIn: () => ({ isLoaded: true, signIn: mockSignIn, setActive: jest.fn() }),
  useSignUp: () => ({ isLoaded: true, signUp: mockSignUp, setActive: jest.fn() }),
}));
jest.mock('expo-network', () => ({ useNetworkState: () => mockNetwork }));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('../clerk', () => ({ clearClerkLocalSession: jest.fn().mockResolvedValue() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../i18n', () => ({ useT: () => jest.requireActual('../i18n/en').en }));
jest.mock('../appAccess', () => ({
  requestAppAccess: (...args) => mockRequest(...args), fetchMyAppAccess: (...args) => mockMyAccess(...args),
  hasApprovedAppAccess: (...args) => mockCached(...args), rememberAppAccess: (...args) => mockRemember(...args),
  forgetAppAccess: (...args) => mockForget(...args),
}));
jest.mock('../api', () => ({ ApiError: class extends Error {}, ensurePatientOnboarded: (...args) => mockOnboard(...args) }));
jest.mock('../storage', () => ({ suspendRecordingAccessForAuthLoss: jest.fn() }));
jest.mock('../diagnostics', () => ({ recordDiagnostic: jest.fn(), diagnosticErrorData: () => ({}), exportDiagnostics: jest.fn(), clearDiagnostics: jest.fn().mockResolvedValue() }));
jest.mock('../connectivity', () => ({
  withTimeout: promise => promise, isConnectionFailure: () => false, showConnectionAlert: jest.fn(),
  isMissingClerkAccount: error => error.code === 'missing',
}));

let screen;
const props = { authRetry: null, onAuthRetryConsumed: () => {}, onDirectAuthFailure: () => false,
  onDirectBootstrapFailure: () => false, onRetryAuth: () => {} };
const content = React.createElement(Text, null, 'Protected app');
async function render(component = AuthGate, extra = props) {
  await act(async () => { screen = create(React.createElement(component, extra, content)); });
}
function text() { return screen.root.findAllByType(Text).map(n => n.props.children).flat().join(' '); }
function button(title) { return screen.root.findAllByType(Button).find(b => b.props.title === title); }
async function enter(email = 'new@example.com') {
  act(() => screen.root.findByType(TextInput).props.onChangeText(email));
  await act(async () => button(en.common.continue).props.onPress());
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { isLoaded: true, isSignedIn: false, userId: null };
  mockNetwork = { isConnected: true };
  mockRequest.mockReset().mockResolvedValue({ status: 'pending' });
  mockMyAccess.mockReset().mockResolvedValue({ status: 'pending', email: 'new@example.com' });
  mockCached.mockReset().mockResolvedValue(false);
  mockRemember.mockReset().mockResolvedValue(); mockForget.mockReset().mockResolvedValue();
  mockOnboard.mockReset().mockResolvedValue();
  mockSignOut.mockReset().mockResolvedValue(); mockSetActive.mockReset().mockResolvedValue();
  mockSignIn.create.mockReset().mockResolvedValue({ supportedFirstFactors: [{ strategy: 'email_code', emailAddressId: 'email-1' }] });
  mockSignIn.prepareFirstFactor.mockResolvedValue();
  mockSignUp.create.mockReset().mockResolvedValue({});
  mockSignUp.prepareEmailAddressVerification.mockResolvedValue();
});
afterEach(() => { if (screen) act(() => screen.unmount()); screen = undefined; });

it('shows a waiting-list confirmation without creating an account or sending a code', async () => {
  await render(); await enter(' New@Example.com ');
  expect(mockRequest).toHaveBeenCalledWith('new@example.com');
  expect(text()).toContain(en.auth.waitlistTitle);
  expect(text()).toContain('new@example.com');
  expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
  expect(mockSignIn.create).not.toHaveBeenCalled();
  expect(mockSignUp.create).not.toHaveBeenCalled();
  expect(mockSignIn.prepareFirstFactor).not.toHaveBeenCalled();
});
it('keeps the existing approved-email code sign-in flow', async () => {
  mockRequest.mockResolvedValue({ status: 'approved' });
  await render(); await enter();
  expect(mockSignIn.prepareFirstFactor).toHaveBeenCalledWith({ strategy: 'email_code', emailAddressId: 'email-1' });
  expect(screen.root.findByType(TextInput).props.textContentType).toBe('oneTimeCode');
  expect(mockSignUp.create).not.toHaveBeenCalled();
});
it('lets an approved new email create its account and verify by email code', async () => {
  mockRequest.mockResolvedValue({ status: 'approved' });
  mockSignIn.create.mockRejectedValue({ code: 'missing' });
  await render(); await enter();
  expect(mockSignUp.create).toHaveBeenCalledWith({ emailAddress: 'new@example.com' });
  expect(mockSignUp.prepareEmailAddressVerification).toHaveBeenCalledWith({ strategy: 'email_code' });
});
it('rechecks waiting-list access and sends a code only after approval', async () => {
  await render(); await enter();
  await act(async () => button(en.auth.checkAccess).props.onPress());
  expect(mockSignIn.prepareFirstFactor).not.toHaveBeenCalled();
  mockRequest.mockResolvedValue({ status: 'approved' });
  await act(async () => button(en.auth.checkAccess).props.onPress());
  expect(mockSignIn.prepareFirstFactor).toHaveBeenCalledTimes(1);
});
it('offers another email and does not send codes when the access service fails', async () => {
  await render(); await enter();
  act(() => button(en.auth.useDifferentEmail).props.onPress());
  mockRequest.mockRejectedValue(new Error('Service unavailable'));
  await enter('another@example.com');
  expect(text()).toContain('Service unavailable');
  expect(mockSignIn.create).not.toHaveBeenCalled();
});
it('blocks an unapproved signed-in session from seeing the app or onboarding', async () => {
  mockAuth = { isLoaded: true, isSignedIn: true, userId: 'account-b' };
  await render();
  expect(text()).toContain(en.auth.waitlistTitle);
  expect(text()).not.toContain('Protected app');
  expect(mockOnboard).not.toHaveBeenCalled();
  await act(async () => button(en.auth.useDifferentEmail).props.onPress());
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});
it('finishes approved onboarding before opening the app for the first time', async () => {
  let finish;
  mockMyAccess.mockResolvedValue({ status: 'approved' });
  mockOnboard.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(AppAccessGate, { accountId: 'account-b' });
  expect(text()).not.toContain('Protected app');
  await act(async () => finish());
  expect(text()).toContain('Protected app');
  expect(mockRemember).toHaveBeenCalledWith('account-b');
});
it('preserves offline use only for an account previously approved on this device', async () => {
  mockNetwork = { isConnected: false };mockCached.mockResolvedValue(true);
  await render(AppAccessGate, { accountId: 'account-a' });
  expect(text()).toContain('Protected app');
  expect(mockMyAccess).not.toHaveBeenCalled();
  mockCached.mockResolvedValue(false);
  await act(async () => screen.update(React.createElement(AppAccessGate, { accountId: 'account-b' }, content)));
  expect(text()).not.toContain('Protected app');
});
it('does not let a slow approved-account response unlock a different account', async () => {
  let finishA;
  mockCached.mockImplementation(account => Promise.resolve(account === 'account-a'));
  mockMyAccess.mockImplementation(account => account === 'account-a'
    ? new Promise(resolve => { finishA = resolve; }) : Promise.resolve({ status: 'pending', email: 'b@example.com' }));
  await render(AppAccessGate, { accountId: 'account-a' });
  expect(text()).toContain('Protected app');
  await act(async () => screen.update(React.createElement(AppAccessGate, { accountId: 'account-b' }, content)));
  expect(text()).not.toContain('Protected app');
  await act(async () => finishA({ status: 'approved' }));
  expect(text()).not.toContain('Protected app');
  expect(text()).toContain('b@example.com');
});
it('allows changing email from an access error even when remote sign-out fails', async () => {
  mockMyAccess.mockRejectedValue(new Error('offline'));
  mockSignOut.mockRejectedValue(new Error('offline'));
  await render(AppAccessGate, { accountId: 'account-b' });
  expect(text()).not.toContain('Protected app');
  await act(async () => button(en.auth.useDifferentEmail).props.onPress());
  expect(mockSetActive).toHaveBeenCalledWith({ session: null });
  expect(require('../clerk').clearClerkLocalSession).toHaveBeenCalledTimes(1);
});
