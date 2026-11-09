const React = require('react');
const { act, create } = require('react-test-renderer');
const Notifications = require('expo-notifications');
const { ProcessingNotifications } = require('../../components/ProcessingNotifications');
let mockAccount = 'A';
let mockRecordings;
const mockRouter = { push: jest.fn() };
jest.mock('@clerk/clerk-expo', () => ({ useUser: () => ({ user: { id: mockAccount } }) }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../storage', () => ({ useRecordings: () => ({ recordings: mockRecordings, loading: false }) }));
jest.mock('../i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
let screen;
beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = 'A';
  mockRecordings = [{ id: 'clip', guestId: 'guest', evaluationRun: { id: 'run' } }];
});
afterEach(() => { if (screen) act(() => screen.unmount()); screen = undefined; });
const response = {
  notification: { request: { identifier: 'ready-A', content: { data: {
    kind: 'results-ready', accountId: 'A', recordingId: 'clip', guestId: 'guest', checkupId: 'run',
  } } } },
};
it.each(['account change', 'unmount'])('ignores a deferred last response after %s', async change => {
  let resolve;
  Notifications.getLastNotificationResponseAsync.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await act(async () => { screen = create(React.createElement(ProcessingNotifications)); });
  if (change === 'account change') {
    mockAccount = 'B';
    mockRecordings = [];
    await act(async () => { screen.update(React.createElement(ProcessingNotifications)); });
  } else {
    act(() => screen.unmount());
    screen = undefined;
  }
  await act(async () => { resolve(response); });
  expect(mockRouter.push).not.toHaveBeenCalled();
});
it('opens the current account checkup once', async () => {
  Notifications.getLastNotificationResponseAsync.mockResolvedValueOnce(response);
  await act(async () => { screen = create(React.createElement(ProcessingNotifications)); });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/checkups/[id]', params: { id: 'run', guestId: 'guest' } });
  const listener = Notifications.addNotificationResponseReceivedListener.mock.calls[0][0];
  act(() => listener(response));
  expect(mockRouter.push).toHaveBeenCalledTimes(1);
});
