import { describe, expect, it } from 'vitest';
import { parseYearParam, yearOptions } from './years';

describe('yearOptions', () => {
  it('runs from this year back past the SBS start, newest first', () => {
    expect(yearOptions(2026, '2019-03-01', 2026)).toEqual([
      2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019,
    ]);
  });

  it('always offers five years back and the year shown', () => {
    expect(yearOptions(2026, null, 2026)).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
    expect(yearOptions(2027, null, 2026)[0]).toBe(2027);
  });
});

describe('parseYearParam', () => {
  it('accepts four-digit years from 2000', () => {
    expect(parseYearParam('2025')).toBe(2025);
    expect(parseYearParam('1999')).toBeUndefined();
    expect(parseYearParam('20x5')).toBeUndefined();
    expect(parseYearParam(['2025'])).toBeUndefined();
    expect(parseYearParam(undefined)).toBeUndefined();
  });
});
