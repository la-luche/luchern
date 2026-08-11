jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __testing,
  getPrivacyBlurSettings,
  setPrivacyBlurSetting,
} from '../faceBlurSettings';

describe('privacy blur settings', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __testing.reset();
  });

  it('is off by default', async () => {
    await expect(getPrivacyBlurSettings()).resolves.toEqual({
      face: false,
      background: false,
    });
  });

  it('persists each explicit opt-in independently', async () => {
    await setPrivacyBlurSetting('face', true);
    await setPrivacyBlurSetting('background', true);
    expect(await AsyncStorage.getItem(__testing.faceStorageKey)).toBe('true');
    expect(await AsyncStorage.getItem(__testing.backgroundStorageKey)).toBe('true');
    await expect(getPrivacyBlurSettings()).resolves.toEqual({
      face: true,
      background: true,
    });
  });
});
