import { getTest } from '../tests';

describe('instruction demo availability', () => {
  it.each(['gait', 'handMovements', 'toeTapping', 'legAgility'] as const)(
    'uses the selected production demo for %s',
    (testId) => {
      expect(getTest(testId)?.demoVideo).toBeDefined();
      expect(getTest(testId)?.demoPoster).toBeDefined();
    },
  );

  it('keeps the chair-rise demo enabled', () => {
    expect(getTest('arisingFromChair')?.demoVideo).toBeDefined();
    expect(getTest('arisingFromChair')?.demoPoster).toBeDefined();
  });
});
