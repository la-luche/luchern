import { advanceSession, endSession, startSession } from '../session';
import { FULL_TEST_FLOW } from '../tests';

describe('guided full test', () => {
  afterEach(() => endSession());

  it('matches the complete ordered flow', () => {
    expect(FULL_TEST_FLOW).toEqual([
      { testId: 'fingerTapping', evaluatedSide: 'left' },
      { testId: 'fingerTapping', evaluatedSide: 'right' },
      { testId: 'pronationSupination', evaluatedSide: 'left' },
      { testId: 'pronationSupination', evaluatedSide: 'right' },
      { testId: 'handMovements', evaluatedSide: 'left' },
      { testId: 'handMovements', evaluatedSide: 'right' },
      { testId: 'restTremor' },
      { testId: 'toeTapping', evaluatedSide: 'left' },
      { testId: 'toeTapping', evaluatedSide: 'right' },
      { testId: 'legAgility', evaluatedSide: 'left' },
      { testId: 'legAgility', evaluatedSide: 'right' },
      { testId: 'arisingFromChair' },
      { testId: 'gait' },
    ]);
  });

  it('advances through test and side together', () => {
    startSession(FULL_TEST_FLOW);
    expect(advanceSession()).toEqual({
      testId: 'fingerTapping',
      evaluatedSide: 'right',
    });

    for (let index = 2; index < FULL_TEST_FLOW.length; index += 1) {
      expect(advanceSession()).toEqual(FULL_TEST_FLOW[index]);
    }
    expect(advanceSession()).toBeNull();
  });
});
