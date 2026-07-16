const { execFileSync } = require('node:child_process');

const REPOSITORY_URL = 'https://github.com/Skovorp/luchern';

function readGit(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

module.exports = ({ config }) => {
  const sha = process.env.EXPO_PUBLIC_GIT_COMMIT_SHA || readGit(['rev-parse', 'HEAD']);
  const message =
    process.env.EXPO_PUBLIC_GIT_COMMIT_MESSAGE || readGit(['log', '-1', '--pretty=%s']);

  return {
    ...config,
    githubUrl: REPOSITORY_URL,
    extra: {
      ...config.extra,
      gitCommit: sha
        ? {
            message: message || 'Unknown commit message',
            sha,
            url: `${REPOSITORY_URL}/commit/${sha}`,
          }
        : null,
    },
  };
};
