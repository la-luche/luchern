const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// NativeWind compiles the Tailwind CSS in `global.css` into RN styles at
// bundle time. `input` must point at the file that holds the @tailwind
// directives.
module.exports = withNativeWind(config, { input: './src/global.css' });
