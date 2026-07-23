import {
  clampDemoFraming,
  DEFAULT_DEMO_FRAMING,
  formatDemoFraming,
} from '../demoFraming';

describe('demo framing', () => {
  it('keeps the default cover crop unchanged', () => {
    expect(clampDemoFraming(DEFAULT_DEMO_FRAMING)).toEqual(DEFAULT_DEMO_FRAMING);
  });

  it('allows pan at the default scale', () => {
    expect(clampDemoFraming({ scale: 1, x: 0.1, y: -0.2 })).toEqual({
      scale: 1,
      x: 0.1,
      y: -0.2,
    });
  });

  it('clamps pan to the editor range', () => {
    const framing = clampDemoFraming({ scale: 1.4, x: 1, y: -1 });
    expect(framing.scale).toBe(1.4);
    expect(framing.x).toBeCloseTo(0.5);
    expect(framing.y).toBeCloseTo(-0.5);
  });

  it('clamps scale without discarding position', () => {
    expect(clampDemoFraming({ scale: 0.5, x: 0.3, y: -0.3 })).toEqual({
      scale: 1,
      x: 0.3,
      y: -0.3,
    });
  });

  it('formats a source-ready value', () => {
    expect(formatDemoFraming({ scale: 1.251, x: 0.041, y: -0.099 })).toBe(
      '{ scale: 1.25, x: 0.04, y: -0.10 }',
    );
  });
});
