import type { TestId } from './tests';

type RecordingTarget = {
  count: number;
  unit: 'taps' | 'reps' | 'seconds' | 'lifts' | 'steps';
};

/** Targets from the approved recording-screen study; repetitions are instructions, not detected counts. */
export const RECORDING_TARGETS: Record<TestId, RecordingTarget> = {
  fingerTapping: { count: 30, unit: 'taps' },
  handMovements: { count: 10, unit: 'reps' },
  pronationSupination: { count: 10, unit: 'seconds' },
  restTremor: { count: 20, unit: 'seconds' },
  toeTapping: { count: 10, unit: 'taps' },
  legAgility: { count: 10, unit: 'lifts' },
  arisingFromChair: { count: 1, unit: 'reps' },
  gait: { count: 10, unit: 'steps' },
};

export const RECORDING_GUIDES: Record<TestId, number> = {
  fingerTapping: require('../../assets/recording-guides/fingerTapping.png'),
  handMovements: require('../../assets/recording-guides/handMovements.png'),
  pronationSupination: require('../../assets/recording-guides/pronationSupination.png'),
  restTremor: require('../../assets/recording-guides/restTremor.png'),
  toeTapping: require('../../assets/recording-guides/toeTapping.png'),
  legAgility: require('../../assets/recording-guides/legAgility.png'),
  arisingFromChair: require('../../assets/recording-guides/arisingFromChair.png'),
  gait: require('../../assets/recording-guides/gait.png'),
};

export function recordingTargetCount(testId: TestId, elapsed: number): number {
  const target = RECORDING_TARGETS[testId];
  return target.unit === 'seconds' ? Math.max(0, target.count - elapsed) : target.count;
}

/** Only timed tests stop automatically. Other tests keep the existing safety limit. */
export function recordingMaxDuration(testId: TestId): number {
  const target = RECORDING_TARGETS[testId];
  return target.unit === 'seconds' ? target.count : 120;
}
