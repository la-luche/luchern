const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withBackgroundWork(config) {
  return withInfoPlist(config, (ios) => {
    const id = `${config.ios.bundleIdentifier}.processing.*`;
    ios.modResults.BGTaskSchedulerPermittedIdentifiers = [...new Set([
      ...(ios.modResults.BGTaskSchedulerPermittedIdentifiers || []), id,
    ])];
    ios.modResults.UIBackgroundModes = [...new Set([
      ...(ios.modResults.UIBackgroundModes || []), 'processing',
    ])];
    return ios;
  });
};
