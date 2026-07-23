export interface DemoFraming {
  /** 1 is the existing edge-to-edge `cover` crop. */
  scale: number;
  /** Horizontal offset as a fraction of the screen width. */
  x: number;
  /** Vertical offset as a fraction of the screen height. */
  y: number;
}

export const DEFAULT_DEMO_FRAMING: DemoFraming = Object.freeze({
  scale: 1,
  x: 0,
  y: 0,
});

export const MIN_DEMO_SCALE = 1;
export const MAX_DEMO_SCALE = 2.5;
export const MAX_DEMO_OFFSET = 0.5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Offsets stay independent from scale so a 1× video can still be moved. This
 * is especially useful vertically, where the instruction panel hides the
 * uncovered lower edge after moving a subject upward.
 */
export function clampDemoFraming(framing: DemoFraming): DemoFraming {
  const scale = clamp(framing.scale, MIN_DEMO_SCALE, MAX_DEMO_SCALE);
  return {
    scale,
    x: clamp(framing.x, -MAX_DEMO_OFFSET, MAX_DEMO_OFFSET),
    y: clamp(framing.y, -MAX_DEMO_OFFSET, MAX_DEMO_OFFSET),
  };
}

export function formatDemoFraming(framing: DemoFraming): string {
  const clean = clampDemoFraming(framing);
  return `{ scale: ${clean.scale.toFixed(2)}, x: ${clean.x.toFixed(2)}, y: ${clean.y.toFixed(2)} }`;
}
