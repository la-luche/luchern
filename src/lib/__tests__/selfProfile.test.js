const React = require('react');
const { act, create } = require('react-test-renderer');
const AsyncStorage = require('@react-native-async-storage/async-storage');
const { apiFetch } = require('../api');
const { clearSelfProfiles, updateSelfProfile, useSelfProfile } = require('../selfProfile');

let mockUser;
jest.mock('@clerk/clerk-expo', () => ({ useUser: () => ({ user: mockUser }) }));
jest.mock('../api', () => ({ apiFetch: jest.fn() }));

let screen;
let current;
function Profile() { current = useSelfProfile(); return null; }
beforeEach(async () => {
  await clearSelfProfiles();
  jest.clearAllMocks();
  mockUser = { id: 'account-1', primaryEmailAddress: { emailAddress: 'owner@example.com' } };
  apiFetch.mockReset().mockResolvedValue({ display_name: 'Owner@Example.com', notes: 'Keep this note' });
});
afterEach(() => { if (screen) act(() => screen.unmount()); screen = undefined; });
async function render() { await act(async () => { screen = create(React.createElement(Profile)); }); }

it('treats the onboarding email as the default personal name without losing notes', async () => {
  await render();
  expect(current.profile).toEqual({ name: '', notes: 'Keep this note' });
});
it('also removes the old email fallback when loading an offline profile cache', async () => {
  await AsyncStorage.setItem('luche.self-profile.v1.account-1', JSON.stringify({ name: 'owner@example.com', notes: 'Offline note' }));
  apiFetch.mockRejectedValue(new Error('offline'));
  await render();
  expect(current.profile).toEqual({ name: '', notes: 'Offline note' });
});
it('keeps a chosen personal name while leaving the account email intact', async () => {
  await render();
  apiFetch.mockResolvedValue({ display_name: 'Peter', notes: 'Updated note' });
  await act(async () => { await updateSelfProfile('account-1', { name: 'Peter', notes: 'Updated note' }); });
  expect(current.profile).toEqual({ name: 'Peter', notes: 'Updated note' });
  expect(mockUser.primaryEmailAddress.emailAddress).toBe('owner@example.com');
  expect(apiFetch).toHaveBeenLastCalledWith('/me', {
    method: 'PATCH', body: JSON.stringify({ name: 'Peter', notes: 'Updated note' }),
  }, 'account-1');
});
