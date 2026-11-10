const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const plist = require('@expo/plist').default;

const root = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const json = (value) => JSON.stringify(value, null, 2) + '\n';

function writeChanged(file, value) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === value) return;
  const temporary = `${file}.version-tmp`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
}

function validate(state) {
  if (!/^\d+\.\d+\.\d+$/.test(state.version) ||
      !Number.isSafeInteger(state.buildNumber) || state.buildNumber < 1 ||
      state.buildNumber >= 2100000000 || !Array.isArray(state.platforms) ||
      state.platforms.some((p) => !['ios', 'android'].includes(p))) {
    throw new Error('Invalid shared build-version.json');
  }
}

function sourceHash(directory) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }).split('\0').filter(Boolean);
  const hash = crypto.createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    if (file === 'build-version.json' || file.endsWith('.version-tmp')) continue;
    const fullPath = path.join(directory, file);
    hash.update(file + '\0');
    if (!fs.existsSync(fullPath)) { hash.update('deleted\0'); continue; }
    if (fs.lstatSync(fullPath).isSymbolicLink()) {
      hash.update(fs.readlinkSync(fullPath) + '\0');
      continue;
    }
    let data = fs.readFileSync(fullPath);
    // Version writes must not make the matching platform look like new source.
    if (['app.json', 'package.json', 'package-lock.json'].includes(file)) {
      const parsed = JSON.parse(data.toString());
      if (file === 'app.json') {
        delete parsed.expo.version;
        if (parsed.expo.ios) delete parsed.expo.ios.buildNumber;
        if (parsed.expo.android) delete parsed.expo.android.versionCode;
      } else {
        delete parsed.version;
        if (parsed.packages?.['']) delete parsed.packages[''].version;
      }
      data = Buffer.from(JSON.stringify(parsed));
    }
    hash.update(data).update('\0');
  }
  return hash.digest('hex');
}

function nextBuild(state, fingerprint, platforms) {
  validate(state);
  const matchingPlatform = state.sourceHash === fingerprint &&
    platforms.every((platform) => !state.platforms.includes(platform));
  if (matchingPlatform) {
    return { ...state, platforms: [...state.platforms, ...platforms] };
  }
  const parts = state.version.split('.').map(Number);
  parts[2] += 1;
  const next = { version: parts.join('.'), buildNumber: state.buildNumber + 1,
    sourceHash: fingerprint, platforms };
  validate(next);
  return next;
}

function versionFiles(directory, state) {
  validate(state);
  const changes = new Map();
  const app = readJson(path.join(directory, 'app.json'));
  app.expo.version = state.version;
  app.expo.ios = { ...app.expo.ios, buildNumber: String(state.buildNumber) };
  app.expo.android = { ...app.expo.android, versionCode: state.buildNumber };
  changes.set('app.json', json(app));
  for (const file of ['package.json', 'package-lock.json']) {
    const value = readJson(path.join(directory, file));
    value.version = state.version;
    if (value.packages?.['']) value.packages[''].version = state.version;
    changes.set(file, json(value));
  }
  // expo run:* reuses generated projects. Keep those in sync without a clean
  // prebuild, which would discard the native build cache and signing settings.
  const infoPath = 'ios/Luche/Info.plist';
  if (fs.existsSync(path.join(directory, infoPath))) {
    const info = plist.parse(fs.readFileSync(path.join(directory, infoPath), 'utf8'));
    info.CFBundleShortVersionString = state.version;
    info.CFBundleVersion = String(state.buildNumber);
    changes.set(infoPath, plist.build(info));
  }
  const projectPath = 'ios/Luche.xcodeproj/project.pbxproj';
  if (fs.existsSync(path.join(directory, projectPath))) {
    const project = fs.readFileSync(path.join(directory, projectPath), 'utf8');
    if (!project.includes('CURRENT_PROJECT_VERSION =')) throw new Error('Unrecognized iOS version settings');
    changes.set(projectPath, project
      .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${state.buildNumber};`)
      .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${state.version};`));
  }
  const gradlePath = 'android/app/build.gradle';
  if (fs.existsSync(path.join(directory, gradlePath))) {
    const gradle = fs.readFileSync(path.join(directory, gradlePath), 'utf8');
    if ((gradle.match(/^\s*versionCode \d+\s*$/gm) ?? []).length !== 1 ||
        (gradle.match(/^\s*versionName "[^"]+"\s*$/gm) ?? []).length !== 1) {
      throw new Error('Unrecognized Android version settings; refusing a partial update');
    }
    changes.set(gradlePath, gradle.replace(/versionCode \d+/, `versionCode ${state.buildNumber}`)
      .replace(/versionName "[^"]+"/, `versionName "${state.version}"`));
  }
  return changes;
}

function checkEas(directory) {
  const eas = readJson(path.join(directory, 'eas.json'));
  if (eas.cli.appVersionSource !== 'local' ||
      Object.values(eas.build).some((profile) => profile.autoIncrement)) {
    throw new Error('EAS must use local versions with autoIncrement disabled');
  }
}

function prepareBuild(directory, platform) {
  if (!['ios', 'android', 'all'].includes(platform)) throw new Error('Choose ios, android, or all');
  const lock = path.join(directory, '.expo/build-version.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  try { fs.mkdirSync(lock); } catch { throw new Error('Another build is preparing its version'); }
  try {
    checkEas(directory);
    const state = nextBuild(readJson(path.join(directory, 'build-version.json')), sourceHash(directory),
      platform === 'all' ? ['ios', 'android'] : [platform]);
    const changes = versionFiles(directory, state); // Validate all native files before writing any.
    // Reserve first: a failed compilation consumes its number; never recycle it.
    writeChanged(path.join(directory, 'build-version.json'), json(state));
    for (const [file, value] of changes) writeChanged(path.join(directory, file), value);
    return state;
  } finally { fs.rmdirSync(lock); }
}

function checkBuild(directory) {
  checkEas(directory);
  const state = readJson(path.join(directory, 'build-version.json'));
  const expected = versionFiles(directory, state);
  const mismatches = [...expected].filter(([file, value]) => {
    const actual = fs.readFileSync(path.join(directory, file), 'utf8');
    if (file.endsWith('.json')) return JSON.stringify(JSON.parse(actual)) !== JSON.stringify(JSON.parse(value));
    if (file.endsWith('.plist')) return JSON.stringify(plist.parse(actual)) !== JSON.stringify(plist.parse(value));
    return actual !== value;
  }).map(([file]) => file);
  if (mismatches.length) throw new Error(`Version mismatch: ${mismatches.join(', ')}. Run build:prepare before compiling.`);
  // EAS archives omit development files via .easignore and may retain a shallow
  // .git directory. The full-source fingerprint is checked before submission;
  // native/config/artifact checks still run on the build worker.
  if (process.env.EAS_BUILD !== 'true' && fs.existsSync(path.join(directory, '.git')) && state.sourceHash !== sourceHash(directory)) {
    throw new Error('Source changed after version preparation. Run build:prepare before compiling.');
  }
  if (process.env.EAS_BUILD_PLATFORM && !state.platforms.includes(process.env.EAS_BUILD_PLATFORM)) {
    throw new Error('This platform has no version reservation. Use the npm build command.');
  }
  return state;
}

if (require.main === module) {
  try {
    const [command, platform] = process.argv.slice(2);
    if (!['prepare', 'check'].includes(command)) throw new Error('Use prepare <ios|android|all> or check');
    const state = command === 'prepare' ? prepareBuild(root, platform) : checkBuild(root);
    console.log(`Luche ${state.version} (Build ${state.buildNumber}) [${state.platforms.join(', ')}]`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { prepareBuild, checkBuild, nextBuild, sourceHash };
