import AsyncStorage from '@react-native-async-storage/async-storage';
import { readHistorySelection, rememberHistorySelection } from '../historySelection';

it('remembers the person and history section separately for each account', async () => {
  const guest = { person: { kind: 'guest' as const, id: 'guest-1' }, section: 'checkups' as const };
  const shared = { person: { kind: 'shared' as const, id: 'patient' }, section: 'tests' as const };
  await rememberHistorySelection('a', guest);
  await rememberHistorySelection('b', shared);
  expect(await readHistorySelection('a')).toEqual(guest);
  expect(await readHistorySelection('b')).toEqual(shared);
  expect(await readHistorySelection('new-account')).toEqual({ person: { kind: 'me' }, section: 'checkups' });
  expect(JSON.parse((await AsyncStorage.getItem('luche:history-selection:a'))!)).toEqual(guest);
});
it('restores a saved selection from disk and safely handles malformed preferences', async () => {
  const selection = { person: { kind: 'guest', id: 'saved' }, section: 'tests' };
  await AsyncStorage.setItem('luche:history-selection:restored', JSON.stringify(selection));
  expect(await readHistorySelection('restored')).toEqual(selection);
  await AsyncStorage.setItem('luche:history-selection:broken', '{bad');
  expect((await readHistorySelection('broken')).person).toEqual({ kind: 'me' });
});
