import { describe, expect, it } from 'vitest';
import { excelSerialToIso, parseDate } from './dates';

describe('excelSerialToIso', () => {
  it.each([
    ['45812', '2025-06-04'], // fixture: PMI on 04.06.2025
    ['45813', '2025-06-05'],
    ['45819', '2025-06-11'],
    ['45812.75', '2025-06-04'], // time of day dropped
    ['32874', '1990-01-01'], // earliest accepted date
    ['36526', '2000-01-01'],
    ['46022', '2025-12-31'],
  ])('%s -> %s (1900 system)', (serial, iso) => {
    expect(excelSerialToIso(serial)).toBe(iso);
  });

  it('supports the 1904 date system', () => {
    expect(excelSerialToIso('44350', true)).toBe('2025-06-04');
  });

  it.each(['', 'abc', '-1', '1e5', '60'])('rejects %j', (s) => {
    expect(excelSerialToIso(s)).toBeNull();
  });

  it('rejects dates outside the plausible range', () => {
    expect(excelSerialToIso('100')).toBeNull(); // 1900
    expect(excelSerialToIso('999999')).toBeNull();
  });
});

describe('parseDate', () => {
  it.each([
    ['04.06.2025', 'DD.MM.YYYY', '2025-06-04'],
    ['4.6.2025', 'DD.MM.YYYY', '2025-06-04'],
    ['15.06.25', 'DD.MM.YY', '2025-06-15'],
    ['2025-06-04', 'YYYY-MM-DD', '2025-06-04'],
    ['2025-06-04T00:00:00', 'YYYY-MM-DD', '2025-06-04'],
    ['04/06/2025', 'DD/MM/YYYY', '2025-06-04'],
    ['06/04/2025', 'MM/DD/YYYY', '2025-06-04'],
    ['04.06.2025 13:45', 'DD.MM.YYYY', '2025-06-04'],
    ['29.02.2024', 'DD.MM.YYYY', '2024-02-29'],
  ] as const)('%s (%s) -> %s', (input, format, iso) => {
    expect(parseDate(input, format)).toBe(iso);
  });

  it.each([
    ['31.04.2025', 'DD.MM.YYYY'],
    ['29.02.2025', 'DD.MM.YYYY'],
    ['13/13/2025', 'MM/DD/YYYY'],
    ['2025-6-4x', 'YYYY-MM-DD'],
    ['04.06.2025', 'DD.MM.YY'],
    ['brunva', 'DD.MM.YYYY'],
    ['', 'DD.MM.YYYY'],
  ] as const)('rejects %s as %s', (input, format) => {
    expect(parseDate(input, format)).toBeNull();
  });
});
