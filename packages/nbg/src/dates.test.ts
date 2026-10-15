import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, eachDay, tbilisiDate } from './dates';

describe('date helpers', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days and lists a closed range', () => {
    expect(daysBetween('2026-10-09', '2026-10-12')).toBe(3);
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(eachDay('2026-10-02', '2026-10-01')).toEqual([]);
  });

  it('rejects malformed dates', () => {
    expect(() => addDays('2026-13-01', 1)).toThrow(RangeError);
  });

  it('gives the Tbilisi calendar date (UTC+4)', () => {
    expect(tbilisiDate(new Date('2026-10-15T19:59:59Z'))).toBe('2026-10-15');
    expect(tbilisiDate(new Date('2026-10-15T20:00:00Z'))).toBe('2026-10-16');
  });
});
