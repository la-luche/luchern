const { withAppBuildGradle } = require('expo/config-plugins');

// Luche never scans barcodes: swap expo-camera's bundled ML Kit barcode model
// (ships libbarhopper_v3.so, ~20 MB uncompressed across the four ABIs) for the
// API-identical unbundled Play-services variant, which carries no native lib.
const SUBSTITUTION = `
configurations.all {
    resolutionStrategy.dependencySubstitution {
        substitute module('com.google.mlkit:barcode-scanning') using module('com.google.android.gms:play-services-mlkit-barcode-scanning:18.3.1')
    }
}
`;

module.exports = function withAndroidLeanApk(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (!gradleConfig.modResults.contents.includes('play-services-mlkit-barcode-scanning')) {
      gradleConfig.modResults.contents += SUBSTITUTION;
    }
    return gradleConfig;
  });
};
