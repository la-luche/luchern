/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind v4 requires the preset. Content globs cover the src/ layout
  // used by this Expo Router app.
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Ported from the Swift Luche app (`lucheInk` = #080616). The RN app
        // mirrors that white + near-black palette.
        ink: '#080616',
        // Muted text darkened for older-eye contrast (0.55 → 0.65 → 0.72).
        'ink-muted': 'rgba(8, 6, 22, 0.72)',
        'ink-faint': 'rgba(8, 6, 22, 0.06)',
      },
    },
  },
  plugins: [],
};
