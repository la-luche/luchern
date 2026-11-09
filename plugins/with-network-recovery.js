const { withMainApplication } = require('expo/config-plugins');

function installRecovery(source) {
  const call = 'expo.modules.networkrecovery.NetworkRecovery.install(this)';
  if (source.includes(call)) return source;
  const marker = 'super.onCreate()';
  if (!source.includes(marker)) throw new Error('Cannot install networking recovery before application startup');
  return source.replace(marker, `${call}\n    ${marker}`);
}

module.exports = function withNetworkRecovery(config) {
  return withMainApplication(config, (app) => {
    if (app.modResults.language !== 'kt') throw new Error('Network recovery requires the Kotlin application template');
    app.modResults.contents = installRecovery(app.modResults.contents);
    return app;
  });
};
module.exports.installRecovery = installRecovery;
