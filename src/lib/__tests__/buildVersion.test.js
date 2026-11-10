/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { prepareBuild, checkBuild, sourceHash } = require('../../../scripts/build-version.cjs');
const { verifyBuild } = require('../../../scripts/verify-build.cjs');
const plist = require('@expo/plist').default;

let directory;
const write = (name, value) => {
  const file = path.join(directory, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
};
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luche-version-'));
  execFileSync('git', ['init', '-q', directory]);
  write('.gitignore', '.expo/\nios/\nandroid/\n');
  write('build-version.json', { version: '1.0.1', buildNumber: 36, sourceHash: null, platforms: [] });
  write('app.json', { expo: { version: '1.0.1', ios: {}, android: {} } });
  write('package.json', { name: 'test', version: '1.0.1' });
  write('package-lock.json', { version: '1.0.1', packages: { '': { version: '1.0.1' } } });
  write('eas.json', { cli: { appVersionSource: 'local' }, build: { production: { autoIncrement: false } } });
  write('android/app/build.gradle', 'defaultConfig {\n versionCode 1\n versionName "1.0.1"\n}\n');
  write('src/app.ts', 'first source');
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

test('matching iOS/Android builds share a version; another build advances both counters', () => {
  const fingerprint = sourceHash(directory);
  expect(prepareBuild(directory, 'ios')).toMatchObject({ version: '1.0.2', buildNumber: 37 });
  expect(sourceHash(directory)).toBe(fingerprint);
  expect(prepareBuild(directory, 'android')).toMatchObject({ version: '1.0.2', buildNumber: 37, platforms: ['ios', 'android'] });
  expect(prepareBuild(directory, 'android')).toMatchObject({ version: '1.0.3', buildNumber: 38 });
  expect(prepareBuild(directory, 'ios')).toMatchObject({ version: '1.0.3', buildNumber: 38 });
  expect(checkBuild(directory).buildNumber).toBe(38);
});

test('changed or untracked source cannot reuse the other platform’s earlier number', () => {
  prepareBuild(directory, 'ios');
  write('src/new.ts', 'a new feature');
  expect(() => checkBuild(directory)).toThrow('Source changed after version preparation');
  expect(prepareBuild(directory, 'android').buildNumber).toBe(38);
  write('src/app.ts', 'changed source');
  expect(prepareBuild(directory, 'ios').buildNumber).toBe(39);
});

test('an all-platform build reserves one new version for both', () => {
  expect(prepareBuild(directory, 'all')).toMatchObject({ buildNumber: 37, platforms: ['ios', 'android'] });
  expect(prepareBuild(directory, 'all').buildNumber).toBe(38);
});

test('stale native metadata is rejected by validation', () => {
  prepareBuild(directory, 'ios');
  write('android/app/build.gradle', 'defaultConfig {\n versionCode 1\n versionName "1.0.1"\n}\n');
  expect(() => checkBuild(directory)).toThrow('Version mismatch: android/app/build.gradle');
});

test('EAS archives can omit development files but must retain matching native versions', () => {
  prepareBuild(directory, 'all');
  fs.unlinkSync(path.join(directory, 'src/app.ts'));
  const previous = process.env.EAS_BUILD;
  process.env.EAS_BUILD = 'true';
  try {
    expect(checkBuild(directory).buildNumber).toBe(37);
    write('android/app/build.gradle', 'defaultConfig {\n versionCode 1\n versionName "1.0.1"\n}\n');
    expect(() => checkBuild(directory)).toThrow('Version mismatch');
  } finally {
    if (previous === undefined) delete process.env.EAS_BUILD;
    else process.env.EAS_BUILD = previous;
  }
});

test('invalid native files and independent remote counters cannot partially reserve a build', () => {
  write('android/app/build.gradle', 'versionCode fromSomeOtherPlace');
  expect(() => prepareBuild(directory, 'ios')).toThrow('Unrecognized Android');
  expect(JSON.parse(fs.readFileSync(path.join(directory, 'build-version.json'))).buildNumber).toBe(36);
  write('eas.json', { cli: { appVersionSource: 'remote' }, build: {} });
  expect(() => prepareBuild(directory, 'ios')).toThrow('EAS must use local versions');
});

test('another preparation holds the lock without losing its reservation', () => {
  fs.mkdirSync(path.join(directory, '.expo/build-version.lock'), { recursive: true });
  expect(() => prepareBuild(directory, 'ios')).toThrow('Another build');
  expect(fs.existsSync(path.join(directory, '.expo/build-version.lock'))).toBe(true);
});

test('artifact verification reads the real app metadata and rejects stale builds or another app', () => {
  const app = path.join(directory, 'Luche.app');
  const state = { version: '1.0.2', buildNumber: 37 };
  const info = { CFBundleShortVersionString: '1.0.2', CFBundleVersion: '37', CFBundleIdentifier: 'ai.getferal.luche' };
  write('Luche.app/Info.plist', plist.build(info));
  expect(verifyBuild(app, state)).toMatchObject({ version: '1.0.2', buildNumber: '37' });
  write('Luche.app/Info.plist', plist.build({ ...info, CFBundleVersion: '36.3' }));
  expect(() => verifyBuild(app, state)).toThrow('Artifact mismatch');
  write('Luche.app/Info.plist', plist.build({ ...info, CFBundleShortVersionString: '1.0.1' }));
  expect(() => verifyBuild(app, state)).toThrow('Artifact mismatch');
  write('Luche.app/Info.plist', plist.build({ ...info, CFBundleIdentifier: 'some.other.app' }));
  expect(() => verifyBuild(app, state)).toThrow('Artifact mismatch');
});
