import type { TestId } from './tests';

export const IOS_STANDARD_WIDE_LENS = 'builtInWideAngleCamera';
export const IOS_ULTRA_WIDE_LENS = 'builtInUltraWideCamera';

const ULTRA_WIDE_TESTS: ReadonlySet<TestId> = new Set([
  'arisingFromChair',
  'gait',
]);

/**
 * Physical rear camera requested for each test on iOS. Selecting the lens
 * explicitly avoids inheriting a user's system-preferred virtual camera,
 * whose minimum zoom can start on the 0.5x constituent lens.
 */
export function preferredRearCameraLens(testId: TestId): string {
  return ULTRA_WIDE_TESTS.has(testId) ? IOS_ULTRA_WIDE_LENS : IOS_STANDARD_WIDE_LENS;
}
