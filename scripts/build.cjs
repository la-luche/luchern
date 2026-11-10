const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepareBuild } = require('./build-version.cjs');
const { verifyBuild } = require('./verify-build.cjs');
const fs = require('node:fs');

const [platform, mode, ...args] = process.argv.slice(2);
const root = path.resolve(__dirname, '..');
try {
  if (!['ios', 'android', 'all'].includes(platform) || !['dev', 'local'].includes(mode) ||
      (platform === 'all' && mode === 'dev')) throw new Error('Use <ios|android|all> <dev|local>');
  if (mode === 'local' && args.some((arg) => /^--(platform|local|auto-submit|output)/.test(arg))) {
    throw new Error('Platform, local-only building, and versioned artifact paths are managed here; submission is separate.');
  }
  const version = prepareBuild(root, platform);
  console.log(`Building Luche ${version.version} (Build ${version.buildNumber})`);
  for (const target of platform === 'all' ? ['ios', 'android'] : [platform]) {
    const command = mode === 'dev' ? 'npx' : 'eas';
    const defaults = args.some((arg) => arg === '--profile' || arg.startsWith('--profile='))
      ? [] : ['--profile', target === 'ios' ? 'production' : 'preview'];
    const commandArgs = mode === 'dev' ? ['expo', `run:${target}`, ...args]
      : ['build', '--local', '--platform', target, ...defaults, ...args];
    const output = path.join(root, 'artifacts/builds', `Luche-${version.version}-${version.buildNumber}.${target === 'ios' ? 'ipa' : 'apk'}`);
    if (mode === 'local') {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      if (fs.existsSync(output)) throw new Error(`Artifact already exists: ${output}`);
      commandArgs.push('--output', output);
    }
    const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    if (mode === 'local') {
      verifyBuild(output, version);
      console.log(`Verified ${output}`);
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
