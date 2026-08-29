jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __testing,
  getPrivacyBlurSettings,
  setPrivacyBlurEnabled,
} from '../faceBlurSettings';

describe('privacy blur settings', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __testing.reset();
  });

  it('is mandatory by default', async () => {
    await expect(getPrivacyBlurSettings()).resolves.toEqual({
      face: true,
      background: true,
    });
  });

  it('persists one depersonalisation preference for both protections', async () => {
    await setPrivacyBlurEnabled(true);
    expect(await AsyncStorage.getItem(__testing.depersonalisationStorageKey)).toBe('true');
    expect(await AsyncStorage.getItem(__testing.faceStorageKey)).toBe('true');
    expect(await AsyncStorage.getItem(__testing.backgroundStorageKey)).toBe('true');
    await expect(getPrivacyBlurSettings()).resolves.toEqual({
      face: true,
      background: true,
    });
  });

  it('migrates either previous opt-in to full depersonalisation', async () => {
    await AsyncStorage.setItem(__testing.faceStorageKey, 'true');

    await expect(getPrivacyBlurSettings()).resolves.toEqual({
      face: true,
      background: true,
    });
    expect(await AsyncStorage.getItem(__testing.depersonalisationStorageKey)).toBe('true');
    expect(await AsyncStorage.getItem(__testing.backgroundStorageKey)).toBe('true');
  });

  it('migrates an old opt-out to mandatory depersonalisation', async () => {
    await AsyncStorage.multiSet([
      [__testing.depersonalisationStorageKey, 'false'],
      [__testing.faceStorageKey, 'true'],
      [__testing.backgroundStorageKey, 'true'],
    ]);

    await expect(getPrivacyBlurSettings()).resolves.toEqual({
      face: true,
      background: true,
    });
  });

  it('fails closed to enabled when preference storage cannot be read', async () => {
    jest.spyOn(AsyncStorage, 'multiGet').mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(getPrivacyBlurSettings()).resolves.toEqual({
      face: true,
      background: true,
    });
  });
});
