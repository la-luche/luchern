import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { ru } from '../i18n/ru';

describe('localized instruction protocol', () => {
  it.each([
    ['English', en, 'armrests, or on a table beside you', '100 by 3s', '20 seconds'],
    ['Italian', italian, 'braccioli o su un tavolo accanto a te', '100 sottraendo 3', '20 secondi'],
    ['Russian', ru, 'подлокотники или на стол рядом', '100, вычитая по 3', '20 секунд'],
  ] as const)('keeps the rest-tremor protocol complete in %s', (_name, locale, placement, counting, duration) => {
    const test = locale.tests.restTremor;
    const instructions = test.steps.join(' ');

    expect(test.timeEstimate).toContain(duration);
    expect(instructions).toContain(placement);
    expect(instructions).toContain(counting);
    expect(instructions).toContain('100, 97, 94, 91 ...');
    expect(instructions).not.toMatch(/1[,.]?000/);
    expect(instructions).not.toMatch(/[“”«»]/);
    expect(instructions).toContain(duration);
  });
});
