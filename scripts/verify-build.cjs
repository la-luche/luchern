const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function readArtifact(file) {
  if (file.endsWith('.app') || file.endsWith('.ipa')) {
    const script = `import sys,json,plistlib,zipfile,pathlib
p=pathlib.Path(sys.argv[1])
if p.suffix=='.ipa':
 with zipfile.ZipFile(p) as z:
  names=[n for n in z.namelist() if n.startswith('Payload/') and n.count('/')==2 and n.endswith('.app/Info.plist')]
  assert len(names)==1, 'Expected exactly one main app'
  d=plistlib.loads(z.read(names[0]))
else:
 d=plistlib.loads((p/'Info.plist').read_bytes())
print(json.dumps({'version':d['CFBundleShortVersionString'],'buildNumber':str(d['CFBundleVersion']),'bundleId':d['CFBundleIdentifier']}))`;
    return JSON.parse(execFileSync('python3', ['-c', script, file], { encoding: 'utf8' }));
  }
  if (file.endsWith('.apk')) {
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
      path.join(require('node:os').homedir(), 'Library/Android/sdk');
    const folder = path.join(sdk, 'build-tools');
    const aapt = fs.readdirSync(folder).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => path.join(folder, version, 'aapt')).find((candidate) => fs.existsSync(candidate));
    if (!aapt) throw new Error('Android build-tools/aapt is required to verify the APK');
    const output = execFileSync(aapt, ['dump', 'badging', file], { encoding: 'utf8' });
    const line = output.split('\n').find((row) => row.startsWith('package:'));
    const field = (key) => line?.match(new RegExp(`${key}='([^']*)'`))?.[1];
    return { version: field('versionName'), buildNumber: field('versionCode'), bundleId: field('name') };
  }
  throw new Error('Verify a signed .app, .ipa, or .apk artifact');
}

function verifyBuild(file, state = JSON.parse(fs.readFileSync(path.join(root, 'build-version.json')))) {
  const actual = readArtifact(path.resolve(file));
  if (actual.bundleId !== 'ai.getferal.luche' || actual.version !== state.version ||
      actual.buildNumber !== String(state.buildNumber)) {
    throw new Error(`Artifact mismatch: expected Luche ${state.version} (Build ${state.buildNumber}), ` +
      `got ${actual.bundleId} ${actual.version} (Build ${actual.buildNumber})`);
  }
  return actual;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run build:verify -- <app, ipa, or apk>');
    const actual = verifyBuild(process.argv[2]);
    console.log(`Verified installed metadata: ${actual.version} (Build ${actual.buildNumber})`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { readArtifact, verifyBuild };
