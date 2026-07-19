jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __testing,
  getFaceBlurEnabled,
  setFaceBlurEnabled,
} from '../faceBlurSettings';

describe('face blur setting', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __testing.reset();
  });

  it('is off by default', async () => {
    await expect(getFaceBlurEnabled()).resolves.toBe(false);
  });

  it('persists an explicit opt-in', async () => {
    await setFaceBlurEnabled(true);
    expect(await AsyncStorage.getItem(__testing.storageKey)).toBe('true');
    await expect(getFaceBlurEnabled()).resolves.toBe(true);
  });
});
