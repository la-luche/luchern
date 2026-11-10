import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { getAppVersion } from '../appVersion';

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.2', nativeBuildVersion: '37' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '9.9.9' } } }));

test.each(['ios', 'android'] as const)('reports the installed %s binary, not a newer Metro manifest', (os) => {
  jest.replaceProperty(Platform, 'OS', os);
  expect(getAppVersion()).toEqual({ version: '1.0.2', buildNumber: '37' });
});

test('missing native metadata does not pretend the newer manifest is installed', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.replaceProperty(Application, 'nativeApplicationVersion', null);
  jest.replaceProperty(Application, 'nativeBuildVersion', null);
  expect(getAppVersion()).toEqual({ version: null, buildNumber: null });
});

test('web can use its config version', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  expect(getAppVersion().version).toBe('9.9.9');
});

afterEach(() => jest.restoreAllMocks());
