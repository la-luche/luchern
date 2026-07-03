/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind v4 requires the preset. Content globs cover the src/ layout
  // the SDK 57 template uses.
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Ported from the Swift Luche app (`lucheInk` = #080616). The RN app
        // mirrors that white + near-black palette.
        ink: '#080616',
        'ink-muted': 'rgba(8, 6, 22, 0.55)',
        'ink-faint': 'rgba(8, 6, 22, 0.06)',
      },
    },
  },
  plugins: [],
};
