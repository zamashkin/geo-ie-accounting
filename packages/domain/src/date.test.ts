import { describe, expect, it } from 'vitest';
import {
  assertIsoDate,
  dayOf,
  firstDayOf,
  formatPeriod,
  isIsoDate,
  nextPeriod,
  parsePeriod,
  periodOf,
  periodsOfYear,
} from './date';
import { InvalidDateError, InvalidPeriodError } from './errors';

describe('dates and periods', () => {
  it.each(['2026-01-31', '2024-02-29', '2026-12-31', '0001-01-01'])('accepts %s', (date) => {
    expect(isIsoDate(date)).toBe(true);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-01', '26-01-01', ''])(
    'rejects %j',
    (date) => {
      expect(isIsoDate(date)).toBe(false);
      expect(() => {
        assertIsoDate(date);
      }).toThrow(InvalidDateError);
    },
  );

  it('parses and formats periods', () => {
    expect(parsePeriod('2026-09')).toEqual({ year: 2026, month: 9 });
    expect(formatPeriod(2026, 9)).toBe('2026-09');
    expect(() => parsePeriod('2026-13')).toThrow(InvalidPeriodError);
    expect(() => parsePeriod('2026-9')).toThrow(InvalidPeriodError);
    expect(() => formatPeriod(2026, 13)).toThrow(InvalidPeriodError);
    expect(() => formatPeriod(2026.5, 1)).toThrow(InvalidPeriodError);
    expect(() => formatPeriod(10000, 1)).toThrow(InvalidPeriodError);
  });

  it('derives periods and days', () => {
    expect(periodOf('2026-09-30')).toBe('2026-09');
    expect(() => periodOf('2026-09-31')).toThrow(InvalidDateError);
    expect(nextPeriod('2026-09')).toBe('2026-10');
    expect(nextPeriod('2026-12')).toBe('2027-01');
    expect(firstDayOf('2026-02')).toBe('2026-02-01');
    expect(() => firstDayOf('2026-2')).toThrow(InvalidPeriodError);
    expect(dayOf('2026-10', 15)).toBe('2026-10-15');
    expect(() => dayOf('2026-02', 30)).toThrow(InvalidDateError);
    expect(periodsOfYear(2026)).toHaveLength(12);
    expect(periodsOfYear(2026)[0]).toBe('2026-01');
    expect(periodsOfYear(2026)[11]).toBe('2026-12');
  });
});
