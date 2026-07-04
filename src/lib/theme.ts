/**
 * Raw color values for the handful of places className can't reach — vector
 * icon `color` props, the camera overlay, status bar. Kept in sync with
 * tailwind.config.js (`ink`). Ported from Swift `lucheInk` (#080616).
 */
export const COLORS = {
  ink: '#080616',
  inkMuted: 'rgba(8, 6, 22, 0.65)',
  inkFaint: 'rgba(8, 6, 22, 0.35)',
  white: '#FFFFFF',
} as const;
