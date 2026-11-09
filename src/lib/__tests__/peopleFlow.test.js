import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
const React = require('react');
const { act, create } = require('react-test-renderer');
const { Alert, FlatList, Linking, Text, TextInput } = require('react-native');
const Clipboard = require('expo-clipboard');
const toast = require('../toast');
const { Button } = require('../../components/Button');
const { RecordingCard } = require('../../components/RecordingCard');
const { SharedRecordingCard } = require('../../components/SharedRecordingCard');
const { TrendChart } = require('../../components/TrendChart');
const { TestHistoryChart } = require('../../components/ResultsTrends');
const TestHistoryScreen = require('../../app/results/test/[testId]').default;
const PeopleScreen = require('../../app/people').default;
const HistoryScreen = require('../../app/results').default;
const CheckupScreen = require('../../app/checkups/[id]').default;
const MenuScreen = require('../../app/index').default;
const { CheckupCard } = require('../../components/CheckupCard');
const { rememberHistorySelection } = require('../historySelection');
const NewUserScreen = require('../../app/guests/new').default;
const LegacyGuestsScreen = require('../../app/guests').default;
const LegacyGuestScreen = require('../../app/guests/[id]').default;
const { Redirect } = require('expo-router');
const EditUserScreen = require('../../app/edit-user').default;
const AccountScreen = require('../../app/about').default;
const { en } = require('../i18n/en');
const { beginPersonTest, personHistoryHref, personPickerMode } = require('../personFlow');
const { advanceSession, endSession } = require('../session');

let mockParams;
let mockAccountId;
let mockRecordings;
let mockSelfProfile;
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockSetParams = jest.fn();
const mockRefresh = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateSelf = jest.fn();
const mockPrepareDelete = jest.fn();
const mockDeleteGuest = jest.fn();
const mockPatients = jest.fn();
const mockTrials = jest.fn();
const mockUseRecordings = jest.fn();
const mockGuests = [{ id: 'guest-1', name: 'Alex', notes: 'Uses a walking aid' }, { id: 'guest-2', name: 'Sam', notes: '' }];
jest.mock('@clerk/clerk-expo', () => ({
  useUser: () => ({ user: { id: mockAccountId, fullName: 'Account full name', primaryEmailAddress: { emailAddress: 'owner@example.com' } } }),
  useClerk: () => ({ setActive: jest.fn(), signOut: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../components/LanguagePicker', () => ({ LanguagePicker: () => null }));
jest.mock('../faceBlurSettings', () => ({ usePrivacyBlurSettings: () => ({ enabled: true, isLoading: false }) }));
jest.mock('../logout', () => ({ signOutFromDevice: jest.fn() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace, dismissTo: mockDismissTo, setParams: mockSetParams }),
  useFocusEffect: (callback) => require('react').useEffect(callback, [callback]),
  Redirect: () => null,
}));
jest.mock('../../components/Header', () => ({ Header: ({ right }) => right ?? null }));
jest.mock('../../components/Screen', () => ({ Screen: ({ children }) => children }));
jest.mock('../../components/RecordingCard', () => ({ RecordingCard: () => null }));
jest.mock('../../components/SharedRecordingCard', () => ({ SharedRecordingCard: () => null }));
jest.mock('../../components/TrendChart', () => ({ TrendChart: () => null }));
jest.mock('../../components/RecordingThumbnail', () => ({ RecordingThumbnail: () => null }));
jest.mock('../../components/StatusPill', () => ({ StatusPill: () => null }));
jest.mock('../guestStorage', () => ({ useGuests: () => ({ guests: mockGuests, loading: false, refresh: mockRefresh, create: mockCreate, update: mockUpdate }),
  ensureGuestSyncedForAccount: jest.fn().mockResolvedValue({}) }));
jest.mock('../selfProfile', () => ({
  useSelfProfile: () => ({ profile: mockSelfProfile, loading: false, refresh: mockRefresh }),
  updateSelfProfile: (...args) => mockUpdateSelf(...args),
}));
jest.mock('../guestDeletion', () => ({
  prepareGuestDeletion: (...args) => mockPrepareDelete(...args),
  deleteGuestWithRecordings: (...args) => mockDeleteGuest(...args),
  GuestHistoryChangedError: class extends Error {},
}));
jest.mock('../storage', () => ({ useRecordings: (scope) => mockUseRecordings(scope) }));
jest.mock('../sharedRecordings', () => ({
  ...jest.requireActual('../sharedRecordings'),
  fetchSharedPatients: (...args) => mockPatients(...args),
  fetchSharedTrials: (...args) => mockTrials(...args),
}));
jest.mock('../api', () => ({ apiFetch: jest.fn(), ApiError: class extends Error {} }));
jest.mock('../i18n', () => ({ useT: () => jest.requireActual('../i18n/en').en, formatEvaluatedSide: (_t, _test, side) => side }));
let screen;
const incoming = { patient_id: 'shared-1', display_name: 'Taylor' };
const trials = (id) => ({ test_types: [], trials_by_test: { gait: [{ trial_id: id, recorded_at: '2026-11-03T12:00:00Z', score: null }] } });
async function render(Component, props) { await act(async () => { screen = create(React.createElement(Component, props)); }); }
function pressName(name) {
  const control = screen.root.findAll(node => node.props.accessibilityLabel === name && typeof node.props.onPress === 'function')[0];
  expect(control).toBeDefined();
  act(() => control.props.onPress());
}
function button(title) { return screen.root.findAllByType(Button).find(b => b.props.title === title); }
function visibleText() { return screen.root.findAllByType(Text).map(n => n.props.children).flat().join(' '); }
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { mode: 'single' };
  mockSetParams.mockImplementation((params) => {
    mockParams = { ...mockParams, ...params };
    screen.update(React.createElement(HistoryScreen));
  });
  mockAccountId = 'account-1';
  mockSelfProfile = { name: '', notes: 'My note' };
  mockRecordings = [
    { id: 'mine', testId: 'gait', status: 'preparing' },
    { id: 'alex', guestId: 'guest-1', testId: 'gait', status: 'preparing' },
    { id: 'sam', guestId: 'guest-2', testId: 'gait', status: 'preparing' },
  ];
  mockUseRecordings.mockImplementation(({ guestId } = {}) => ({ recordings: mockRecordings.filter(r => r.guestId === guestId), loading: false, refresh: mockRefresh }));
  mockRefresh.mockReset().mockResolvedValue();
  mockCreate.mockReset().mockResolvedValue({ id: 'new-user' });
  mockUpdate.mockReset().mockResolvedValue({});
  mockUpdateSelf.mockReset().mockResolvedValue({});
  mockPrepareDelete.mockReset().mockResolvedValue({ accountId: 'account-1', guestId: 'guest-1', keys: ['a','b','c','d'], testCount: 4 });
  mockDeleteGuest.mockReset().mockResolvedValue();
  mockPatients.mockReset().mockResolvedValue({ patients: [incoming] });
  mockTrials.mockReset().mockResolvedValue(trials(42));
});
afterEach(() => { if (screen) act(() => screen.unmount()); screen = undefined; endSession(); jest.restoreAllMocks(); });

it('copies the support email and opens the restored website and email links', async () => {
  jest.spyOn(Clipboard, 'setStringAsync').mockResolvedValue(true);
  jest.spyOn(Linking, 'openURL').mockResolvedValue();
  jest.spyOn(toast, 'showToast').mockImplementation(() => {});
  await render(AccountScreen);
  await act(async () => button(en.about.copySupportEmail).props.onPress());
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('hello@luche.ai');
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(toast.showToast).toHaveBeenCalledWith(en.about.supportEmailCopied);
  expect(visibleText()).toContain('hello@luche.ai');
  for (const [title, url] of [
    [en.profile.scienceMethodology, 'https://luche.ai/methodology'],
    ['luche.ai', 'https://luche.ai'],
    [en.about.privacyPolicy, 'https://luche.ai/privacy-policy'],
    [en.about.supportTitle, 'https://luche.ai/support'],
    [en.about.emailSupport, 'mailto:hello@luche.ai?subject=Luche%20support'],
  ]) {
    await act(async () => button(title).props.onPress());
    expect(Linking.openURL).toHaveBeenLastCalledWith(url);
  }
});

it('keeps the support address available when copying fails', async () => {
  jest.spyOn(Clipboard, 'setStringAsync').mockRejectedValue(new Error('clipboard unavailable'));
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(AccountScreen);
  await act(async () => button(en.about.copySupportEmail).props.onPress());
  expect(Alert.alert).toHaveBeenCalledWith(en.about.supportCopyFailedTitle, en.about.supportCopyFailedBody);
  expect(visibleText()).toContain('hello@luche.ai');
});

it('shows a guest note and a visible Edit user action in history', async () => {
  mockParams = { guestId: 'guest-1', section: 'checkups' };
  await render(HistoryScreen);
  expect(visibleText()).toContain('Uses a walking aid');
  act(() => button(en.people.editUser).props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/edit-user', params: { guestId: 'guest-1', section: 'checkups' } });
});
it('shows the Me note but no editor for a person shared with the account', async () => {
  mockParams = {};
  await render(HistoryScreen);
  expect(visibleText()).toContain('My note');
  expect(button(en.people.editUser)).toBeDefined();
  mockParams = { patientId: 'shared-1' };
  await act(async () => screen.update(React.createElement(HistoryScreen)));
  expect(button(en.people.editUser)).toBeUndefined();
  expect(visibleText()).toContain(en.people.sharedWithMe);
  expect(visibleText()).not.toContain('My note');
  expect(screen.root.findAll(node => typeof node.props.accessibilityLabel === 'string' &&
    node.props.accessibilityLabel.includes(en.people.sharedWithMe)).length).toBeGreaterThan(0);
});
it('refreshes untouched profile fields while retaining edits already typed', async () => {
  mockParams = {};
  await render(EditUserScreen);
  act(() => screen.root.findAllByType(TextInput)[0].props.onChangeText('New name'));
  mockSelfProfile = { name: 'Server name', notes: 'Note updated on another phone' };
  await act(async () => screen.update(React.createElement(EditUserScreen)));
  expect(screen.root.findAllByType(TextInput).map(field => field.props.value))
    .toEqual(['New name', 'Note updated on another phone']);
  await act(async () => button(en.people.saveUser).props.onPress());
  expect(mockUpdateSelf).toHaveBeenCalledWith('account-1', { name: 'New name', notes: 'Note updated on another phone' });
});
it('starts the personal name editor with Me', async () => {
  mockParams = {};
  await render(EditUserScreen);
  expect(screen.root.findAllByType(TextInput)[0].props.value).toBe(en.resultsList.me);
});
it('uses a renamed personal profile in both the picker and history', async () => {
  mockSelfProfile = { name: 'My chosen name', notes: 'My note' };
  await render(PeopleScreen);
  expect(screen.root.findByType(FlatList).props.data[0]).toMatchObject({ kind: 'me', name: 'My chosen name' });
  pressName('My chosen name');
  expect(mockPush.mock.calls[0][0].params.guestId).toBe('');
  mockParams = {};
  await act(async () => screen.update(React.createElement(HistoryScreen)));
  expect(visibleText()).toContain('My chosen name');
  expect(visibleText()).not.toContain(en.people.sharedWithMe);
  expect(screen.root.findByType(RecordingCard).props.recording.id).toBe('mine');
});
it('keeps Account showing the sign-in email after renaming the personal profile', async () => {
  mockSelfProfile = { name: 'My chosen name', notes: 'Private profile note' };
  await render(AccountScreen);
  expect(visibleText()).toContain('owner@example.com');
  expect(visibleText()).not.toContain('My chosen name');
  expect(visibleText()).not.toContain('Account full name');
});
it.each([undefined, 'guest-1'])('saves the selected user’s name and note (%s)', async (guestId) => {
  mockParams = { guestId, section: 'tests' };
  await render(EditUserScreen);
  const fields = screen.root.findAllByType(TextInput);
  act(() => fields[0].props.onChangeText(' Updated name '));
  act(() => fields[1].props.onChangeText('Updated note'));
  await act(async () => button(en.people.saveUser).props.onPress());
  if (guestId) expect(mockUpdate).toHaveBeenCalledWith(guestId, { name: 'Updated name', notes: 'Updated note' });
  else {
    expect(mockUpdateSelf).toHaveBeenCalledWith('account-1', { name: 'Updated name', notes: 'Updated note' });
    expect(button(en.people.deleteUser)).toBeUndefined();
  }
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/results', params: { guestId: guestId ?? '', patientId: '', section: 'tests' } });
});
it('shows the exact test count and waits for the countdown and final confirmation before deleting', async () => {
  jest.useFakeTimers();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    mockParams = { guestId: 'guest-1', section: 'tests' };
    await render(EditUserScreen);
    await act(async () => button(en.people.deleteUser).props.onPress());
    expect(mockPrepareDelete).toHaveBeenCalledWith('account-1', 'guest-1');
    expect(alert).toHaveBeenCalledWith(en.people.deleteWarningTitle('Alex'), en.people.deleteWarningBody(4), expect.any(Array));
    expect(mockDeleteGuest).not.toHaveBeenCalled();
    act(() => alert.mock.calls[0][2].find(b => b.text === en.common.continue).onPress());
    expect(button(en.people.deleteUserAndTests(4))).toBeUndefined();
    expect(visibleText()).toContain(en.people.deleteWarningBody(4));
    for (let i = 0; i < 5; i++) act(() => jest.advanceTimersByTime(1000));
    expect(mockDeleteGuest).not.toHaveBeenCalled();
    await act(async () => button(en.people.deleteUserAndTests(4)).props.onPress());
    expect(mockDeleteGuest).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/results', params: { guestId: '', patientId: '', section: 'tests' } });
  } finally { jest.useRealTimers(); }
});

it('offers Me and existing users for recording, and carries the chosen user into the test', async () => {
  await render(PeopleScreen);
  expect(screen.root.findByType(FlatList).props.data.map(p => p.name)).toEqual(['Me', 'Alex', 'Sam']);
  expect(mockPatients).not.toHaveBeenCalled();
  pressName('Alex');
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/tests', params: { guestId: 'guest-1' } });
});
it('starts a fresh full check only after choosing Me', async () => {
  mockParams = { mode: 'full' };
  await render(PeopleScreen);
  expect(advanceSession()).toBeNull();
  pressName('Me');
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/prepare', params: { mode: 'full', guestId: '' } });
  expect(advanceSession()).toEqual({ testId: 'fingerTapping', evaluatedSide: 'right' });
});
it('keeps saved users usable offline', async () => {
  mockRefresh.mockRejectedValue(new Error('offline'));
  await render(PeopleScreen);
  expect(visibleText()).toContain(en.people.usersLoadFailed);
  pressName('Sam');
  expect(mockPush.mock.calls[0][0].params.guestId).toBe('guest-2');
});
it('opens the existing creation form with the original flow', async () => {
  mockParams = { mode: 'full' };
  await render(PeopleScreen);
  act(() => button(en.people.createUser).props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/guests/new', params: { mode: 'full' } });
  expect(advanceSession()).toBeNull();
});
it.each(['full', 'single'])('persists a new user before continuing the %s flow', async (mode) => {
  mockParams = { mode };
  await render(NewUserScreen);
  act(() => screen.root.findAllByType(TextInput)[0].props.onChangeText('  Jordan  '));
  await act(async () => button(en.people.createUser).props.onPress());
  expect(mockCreate).toHaveBeenCalledWith('Jordan', '');
  expect(mockReplace.mock.calls[0][0]).toMatchObject({ pathname: mode === 'full' ? '/prepare' : '/tests', params: { guestId: 'new-user' } });
});
it('opens current history after creating a user through an older link', async () => {
  mockParams = {};
  await render(NewUserScreen);
  act(() => screen.root.findAllByType(TextInput)[0].props.onChangeText('Jordan'));
  await act(async () => button(en.people.createUser).props.onPress());
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/results', params: { guestId: 'new-user', patientId: '', section: 'tests' } });
});
it('redirects the retired guest menu to the current person picker', async () => {
  mockParams = {};
  await render(LegacyGuestsScreen);
  expect(screen.root.findByType(Redirect).props.href).toEqual({ pathname: '/people', params: { mode: 'history' } });
});
it('redirects an older guest profile link to that person’s current history', async () => {
  mockParams = { id: 'guest-2' };
  await render(LegacyGuestScreen);
  expect(screen.root.findByType(Redirect).props.href).toEqual({ pathname: '/results', params: { guestId: 'guest-2', patientId: '', section: 'tests' } });
});
it('includes incoming shares only in history, without duplicating the signed-in user', async () => {
  mockParams = { mode: 'history', returnToHistory: '1' };
  mockPatients.mockResolvedValue({ patients: [incoming, { patient_id: 'account-1', display_name: 'My account' }] });
  await render(PeopleScreen);
  expect(screen.root.findByType(FlatList).props.data.map(p => p.name)).toEqual(['Me', 'Alex', 'Sam', 'Taylor']);
  pressName('Taylor');
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/results', params: { guestId: '', patientId: 'shared-1', section: 'tests' } });
});
it('shows only personal history under Me, without Shared with me', async () => {
  mockParams = { guestId: '', patientId: '' };
  await render(HistoryScreen);
  expect(screen.root.findAllByType(RecordingCard).map(card => card.props.recording.id)).toEqual(['mine']);
  expect(visibleText()).not.toContain(en.people.sharedWithMe);
  expect(mockPatients).not.toHaveBeenCalled();
});
it('keeps guest history and detail navigation scoped to that guest', async () => {
  mockParams = { guestId: 'guest-1', patientId: '' };
  await render(HistoryScreen);
  const card = screen.root.findByType(RecordingCard);
  expect(card.props.recording.id).toBe('alex');
  act(() => card.props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/results/[id]', params: { id: 'alex', guestId: 'guest-1', fromHistory: '1' } });
});
it('treats a legacy shared link to this same account as Me', async () => {
  mockParams = { patientId: 'account-1' };
  await render(HistoryScreen);
  expect(screen.root.findByType(RecordingCard).props.recording.id).toBe('mine');
  expect(visibleText()).not.toContain(en.people.sharedWithMe);
  expect(mockPatients).not.toHaveBeenCalled();
});
it('does not let a pending shared request overwrite Me after changing user', async () => {
  let resolve;
  mockTrials.mockReturnValue(new Promise(r => { resolve = r; }));
  mockParams = { patientId: 'shared-1' };
  await render(HistoryScreen);
  expect(mockTrials).toHaveBeenCalledWith('shared-1', 'account-1');
  mockParams = { guestId: '', patientId: '' };
  await act(async () => screen.update(React.createElement(HistoryScreen)));
  await act(async () => resolve(trials(42)));
  expect(screen.root.findAllByType(SharedRecordingCard)).toHaveLength(0);
  expect(screen.root.findByType(RecordingCard).props.recording.id).toBe('mine');
  expect(visibleText()).not.toContain(en.people.sharedWithMe);
});
it('clears old shared history when the signed-in account changes', async () => {
  mockParams = { patientId: 'shared-1' };
  await render(HistoryScreen);
  expect(screen.root.findByType(SharedRecordingCard).props.recording.trialId).toBe(42);
  mockAccountId = 'account-2';
  mockPatients.mockResolvedValue({ patients: [] });
  await act(async () => screen.update(React.createElement(HistoryScreen)));
  expect(screen.root.findAllByType(SharedRecordingCard)).toHaveLength(0);
  expect(mockTrials).toHaveBeenCalledTimes(1);
  expect(visibleText()).toContain(en.resultsList.sharedLoadError);
});
it('opens the guest test-type page from the whole chart card', async () => {
  mockParams = { guestId: 'guest-2' };
  await render(HistoryScreen);
  pressName(en.tests.gait.name);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/results/test/[testId]', params: { testId: 'gait', guestId: 'guest-2', patientId: '' } });
  expect(visibleText()).not.toContain(en.resultsList.trendsTitle);
  expect(visibleText()).toContain(en.resultsList.trendsDisclaimer);
  expect(visibleText()).not.toContain(en.tests.gait.descriptor);
});
it('clears abandoned checkups for a single test and clears both history scopes for Me', () => {
  beginPersonTest('full', 'guest-1');
  beginPersonTest('single');
  expect(advanceSession()).toBeNull();
  expect(personHistoryHref({ kind: 'me' }).params).toEqual({ guestId: '', patientId: '', section: 'tests' });
  expect(personPickerMode('unexpected')).toBeNull();
});
it('groups checkup recordings in Checkups and also includes them in Tests', async () => {
  mockParams = {};
  mockRecordings.push({ id: 'run-clip', testId: 'gait', status: 'processing', createdAt: 1,
    evaluationRun: { id: 'run', startedAt: 1, expectedSteps: 13 } });
  await render(HistoryScreen);
  expect(screen.root.findAllByType(RecordingCard).map(card => card.props.recording.id)).toEqual(['mine', 'run-clip']);
  pressName(en.checkups.checkups);
  expect(screen.root.findAllByType(RecordingCard)).toHaveLength(0);
  const card = screen.root.findByType(CheckupCard);
  expect(card.props.checkup.recordings.map(r => r.id)).toEqual(['run-clip']);
  act(() => card.props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/checkups/[id]', params: { id: 'run', guestId: '', patientId: '' } });
});
it.each([{}, { guestId: 'guest-1' }, { patientId: 'shared-1' }])('keeps the selector fixed and data mounted when switching history tabs (%j)', async (params) => {
  mockParams = params;
  await render(HistoryScreen);
  const selector = () => screen.root.findAll(node => typeof node.props.accessibilityLabel === 'string' &&
    node.props.accessibilityLabel.startsWith(en.people.changeUser + ':') && typeof node.props.onPress === 'function')[0];
  const before = selector();
  for (let ancestor = before.parent; ancestor; ancestor = ancestor.parent) expect(ancestor.type).not.toBe(FlatList);
  const refreshes = mockRefresh.mock.calls.length;
  const sharedFetches = mockTrials.mock.calls.length;
  pressName(en.checkups.checkups);
  expect(mockSetParams).toHaveBeenLastCalledWith({ section: 'checkups' });
  expect(selector()).toBe(before);
  pressName(en.checkups.tests);
  expect(selector()).toBe(before);
  expect(mockRefresh).toHaveBeenCalledTimes(refreshes);
  expect(mockTrials).toHaveBeenCalledTimes(sharedFetches);
  expect(mockReplace).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});
it('opens the individual result from a guest checkup and preserves its return context', async () => {
  mockParams = { id: 'run', guestId: 'guest-1' };
  mockRecordings.push({ id: 'run-clip', guestId: 'guest-1', testId: 'gait', status: 'done', createdAt: 1,
    result: { score: .5, updrsGrade: 2 }, evaluationRun: { id: 'run', startedAt: 1, expectedSteps: 13 } });
  await render(CheckupScreen);
  expect(visibleText()).toContain(en.checkups.overall);
  expect(visibleText()).toContain(en.checkups.left);
  expect(visibleText()).toContain(en.checkups.right);
  expect(visibleText()).toContain(en.checkups.standing);
  pressName(en.tests.gait.name);
  expect(mockPush.mock.calls[0][0].params).toEqual({ id: 'run-clip', guestId: 'guest-1', fromHistory: '1', fromCheckup: 'run' });
});
it.each([undefined, 'guest-1'])('plots the selected person’s overall checkup scores and opens the matching checkup (%s)', async (guestId) => {
  mockParams = { section: 'checkups', guestId };
  mockRecordings = [
    { id: 'left', guestId, testId: 'fingerTapping', evaluatedSide: 'left', createdAt: 1, status: 'done', result: { score: .25, updrsGrade: 1 }, evaluationRun: { id: 'run', startedAt: 1, expectedSteps: 13 } },
    { id: 'right', guestId, testId: 'fingerTapping', evaluatedSide: 'right', createdAt: 2, status: 'done', result: { score: .75, updrsGrade: 3 }, evaluationRun: { id: 'run', startedAt: 1, expectedSteps: 13 } },
    { id: 'other', guestId: 'other-user', testId: 'gait', createdAt: 3, status: 'done', result: { score: 1 }, evaluationRun: { id: 'other-run', startedAt: 3, expectedSteps: 13 } },
  ];
  await render(HistoryScreen);
  const graph = screen.root.findByType(TrendChart);
  expect(graph.props.maxScore).toBe(4);
  expect(graph.props.points).toEqual([{ id: 'run', t: 1, score: 2 }]);
  act(() => graph.props.onPointPress('run'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/checkups/[id]', params: { id: 'run', guestId: guestId || '', patientId: '' } });
});
it('plots shared checkups and preserves the shared person when a point opens', async () => {
  mockParams = { section: 'checkups', patientId: 'shared-1' };
  mockTrials.mockResolvedValue({ test_types: [], trials_by_test: { gait: [
    { trial_id: 1, recorded_at: '2026-11-03T12:00:00Z', score: .5, updrs_grade: 2, evaluation_run_id: 'shared-run' },
    { trial_id: 2, recorded_at: '2026-11-03T13:00:00Z', score: 1 },
  ] } });
  await render(HistoryScreen);
  const graph = screen.root.findByType(TrendChart);
  expect(graph.props.maxScore).toBe(4);
  expect(graph.props.points).toEqual([{ id: 'shared-run', t: Date.parse('2026-11-03T12:00:00Z'), score: 2 }]);
  act(() => graph.props.onPointPress('shared-run'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/checkups/[id]', params: { id: 'shared-run', guestId: '', patientId: 'shared-1' } });
});
it('opens History directly for its last person and section', async () => {
  mockAccountId = 'remembered-history';
  await rememberHistorySelection(mockAccountId, { person: { kind: 'guest', id: 'guest-2' }, section: 'tests' });
  await render(MenuScreen);
  await act(async () => button(en.menu.previousRecordings).props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/results', params: { guestId: 'guest-2', patientId: '', section: 'tests' } });
});
it.each([undefined, 'guest-1'])('shows every recording from tests or checkups below the general test charts (%s)', async (guestId) => {
  mockParams = { guestId };
  mockRecordings = [
    { id: 'old', testId: 'gait', createdAt: 1, status: 'processing' },
    { id: 'new', testId: 'fingerTapping', createdAt: 8, status: 'processing' },
    { id: 'middle', testId: 'gait', createdAt: 4, status: 'processing' },
    { id: 'second', testId: 'toeTapping', createdAt: 6, status: 'processing' },
    { id: 'battery', testId: 'gait', createdAt: 10, status: 'processing', evaluationRun: { id: 'run', startedAt: 10, expectedSteps: 13 } },
  ].map(recording => ({ ...recording, guestId }));
  await render(HistoryScreen);
  expect(screen.root.findByType(FlatList).props.data.map(recording => recording.id)).toEqual(['battery', 'new', 'second', 'middle', 'old']);
  expect(screen.root.findAllByType(RecordingCard).map(c => c.props.recording.id)).toEqual(['battery', 'new', 'second', 'middle', 'old']);
  expect(screen.root.findAllByType(TestHistoryChart).map(c => c.props.testId)).toEqual(['fingerTapping', 'toeTapping', 'gait']);
});
it('filters the test-type page by both person and test, keeping graph and rows in sync', async () => {
  mockParams = { testId: 'gait', guestId: 'guest-1' };
  mockRecordings = [
    { id: 'walk', guestId: 'guest-1', testId: 'gait', createdAt: 1, status: 'done', result: { score: .25 } },
    { id: 'pending', guestId: 'guest-1', testId: 'gait', createdAt: 2, status: 'processing' },
    { id: 'hand', guestId: 'guest-1', testId: 'fingerTapping', createdAt: 3, status: 'done', result: { score: .8 } },
    { id: 'other', guestId: 'guest-2', testId: 'gait', createdAt: 4, status: 'done', result: { score: .9 } },
    { id: 'run-clip', guestId: 'guest-1', testId: 'gait', createdAt: 5, status: 'done', result: { score: .5 }, evaluationRun: { id: 'run' } },
  ];
  await render(TestHistoryScreen);
  expect(screen.root.findAllByType(RecordingCard).map(c => c.props.recording.id)).toEqual(['run-clip', 'pending', 'walk']);
  const graph = screen.root.findByType(TrendChart);
  expect(graph.props.points).toEqual([{ id: 'walk', t: 1, score: .25 }, { id: 'run-clip', t: 5, score: .5 }]);
  act(() => graph.props.onPointPress('walk'));
  expect(mockPush.mock.calls[0][0].params).toEqual({ id: 'walk', guestId: 'guest-1', fromHistory: '1', fromTestType: 'gait' });
});
it('opens shared type history from its chart and shows only that type of shared recordings', async () => {
  mockParams = { patientId: 'shared-1' };
  mockTrials.mockResolvedValue({ test_types: [], trials_by_test: {
    gait: [{ trial_id: 1, recorded_at: '2026-11-03T12:00:00Z', score: .25 }, { trial_id: 2, recorded_at: '2026-11-03T13:00:00Z', score: null },
      { trial_id: 4, recorded_at: '2026-11-03T15:00:00Z', score: .75, evaluation_run_id: 'run' }],
    fingerTapping: [{ trial_id: 3, recorded_at: '2026-11-03T14:00:00Z', score: .5 }],
  } });
  await render(HistoryScreen);
  expect(screen.root.findAllByType(SharedRecordingCard).map(c => c.props.recording.trialId)).toEqual([4, 3, 2, 1]);
  pressName(en.tests.gait.name);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/results/test/[testId]', params: { testId: 'gait', guestId: '', patientId: 'shared-1' } });
  mockParams = { testId: 'gait', patientId: 'shared-1' };
  await act(async () => screen.update(React.createElement(TestHistoryScreen)));
  expect(screen.root.findAllByType(SharedRecordingCard).map(c => c.props.recording.trialId)).toEqual([4, 2, 1]);
  expect(screen.root.findByType(TrendChart).props.points.map(p => p.id)).toEqual(['1', '4']);
});
it('does not let a slow History load override another menu action', async () => {
  const preferences = require('../historySelection');
  let resolve;
  const read = jest.spyOn(preferences, 'readHistorySelection').mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await render(MenuScreen);
  act(() => button(en.menu.previousRecordings).props.onPress());
  act(() => button(en.menu.recordOne).props.onPress());
  await act(async () => resolve({ person: { kind: 'me' }, section: 'checkups' }));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush.mock.calls[0][0].pathname).toBe('/people');
  read.mockRestore();
});
it('updates a pending shared checkup while it remains open', async () => {
  jest.useFakeTimers();
  try {
    mockParams = { id: 'run', patientId: 'shared-1' };
    const response = (score, status) => ({ test_types: [], trials_by_test: { gait: [{
      trial_id: 42, recorded_at: '2026-11-03T12:00:00Z', score, analysis_status: status,
      evaluation_run_id: 'run', evaluation_run_expected_steps: 13,
    }] } });
    mockTrials.mockResolvedValueOnce(response(null, 'processing')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response(.75, 'done'));
    await render(CheckupScreen);
    expect(visibleText()).toContain(en.checkups.available(0, 13));
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(mockTrials).toHaveBeenCalledTimes(2);
    expect(visibleText()).toContain(en.checkups.available(0, 13));
    expect(visibleText()).toContain(en.resultsList.sharedLoadError);
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(mockTrials).toHaveBeenCalledTimes(3);
    expect(visibleText()).toContain(en.checkups.available(1, 13));
    expect(visibleText()).toContain('3.0');
    await act(async () => jest.advanceTimersByTime(20_000));
    expect(mockTrials).toHaveBeenCalledTimes(3);
  } finally {
    if (screen) act(() => screen.unmount());
    screen = undefined;
    jest.useRealTimers();
  }
});
