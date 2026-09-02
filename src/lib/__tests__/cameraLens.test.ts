import {
  IOS_STANDARD_WIDE_LENS,
  IOS_ULTRA_WIDE_LENS,
  preferredRearCameraLens,
} from '../cameraLens';
import { TESTS } from '../tests';

describe('recording camera lens selection', () => {
  it.each(['gait', 'arisingFromChair'] as const)('uses the ultra-wide lens for %s', (testId) => {
    expect(preferredRearCameraLens(testId)).toBe(IOS_ULTRA_WIDE_LENS);
  });

  it('uses the standard wide lens for every other test', () => {
    const regularTests = TESTS.filter(
      ({ id }) => id !== 'gait' && id !== 'arisingFromChair',
    );

    expect(regularTests).not.toHaveLength(0);
    expect(regularTests.every(({ id }) => preferredRearCameraLens(id) === IOS_STANDARD_WIDE_LENS)).toBe(
      true,
    );
  });
});
