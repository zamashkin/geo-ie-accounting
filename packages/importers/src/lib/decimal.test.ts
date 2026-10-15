import { describe, expect, it } from 'vitest';
import type { DecimalSeparator } from './decimal';
import { parseDecimal, parsePlainNumber, toMinor } from './decimal';

const minor = (s: string, sep: DecimalSeparator = '.', exp = 2) => {
  const p = parseDecimal(s, sep);
  return p === null ? null : toMinor(p, exp).minor;
};

describe('parseDecimal + toMinor', () => {
  it.each([
    ['1180.0', 118000n],
    ['690.85', 69085n],
    ['-690.85', -69085n],
    ['0.04', 4n],
    ['.5', 50n],
    ['900.', 90000n], // BoG "USD900.."
    ['1,785.83', 178583n],
    ['1,234,567.89', 123456789n],
    ["1'234.50", 123450n],
    ['1 234.50', 123450n],
    ['1 234.50', 123450n],
    ['(12.30)', -1230n],
    ['12.30-', -1230n],
    ['+5', 500n],
    ['−12.00', -1200n],
    ['-0.00', 0n],
    ['  42  ', 4200n],
  ])('%s -> %s', (input, expected) => {
    expect(minor(input)).toBe(expected);
  });

  it.each([
    ['1.234,56', 123456n],
    ['1 234,56', 123456n],
    ['-12,5', -1250n],
    ['1234', 123400n],
  ])('comma decimal %s -> %s', (input, expected) => {
    expect(minor(input, ',')).toBe(expected);
  });

  it.each([
    '',
    '-',
    'abc',
    '1.2.3',
    '12,34',
    '1,23',
    '1,2345.00',
    'GBP 10',
    '10 GBP',
    '1e5',
    '--1',
    '.',
  ])('rejects %j', (input) => {
    expect(parseDecimal(input, '.')).toBeNull();
  });

  it('handles the currency exponent', () => {
    expect(minor('1000', '.', 0)).toBe(1000n);
    expect(minor('1.234', '.', 3)).toBe(1234n);
    expect(minor('1.5', '.', 3)).toBe(1500n);
  });

  it('rounds extra digits half away from zero and flags it', () => {
    const r = toMinor(parseDecimal('1.005')!, 2);
    expect(r).toEqual({ minor: 101n, rounded: true, floatNoise: false });
    expect(toMinor(parseDecimal('-1.005')!, 2).minor).toBe(-101n);
    expect(toMinor(parseDecimal('1.004')!, 2).minor).toBe(100n);
    expect(toMinor(parseDecimal('1.000')!, 2)).toEqual({
      minor: 100n,
      rounded: false,
      floatNoise: false,
    });
  });

  it('recognises spreadsheet float noise', () => {
    expect(toMinor(parsePlainNumber('1806.7600000000002')!, 2)).toEqual({
      minor: 180676n,
      rounded: true,
      floatNoise: true,
    });
    expect(toMinor(parsePlainNumber('489.18999999999994')!, 2)).toEqual({
      minor: 48919n,
      rounded: true,
      floatNoise: true,
    });
  });

  it('never loses precision on large amounts', () => {
    expect(minor('999,999,999,999,999.99')).toBe(99999999999999999n);
  });

  it('rejects amounts beyond 15 integer digits (keeps minor units inside int64)', () => {
    expect(parseDecimal('1,000,000,000,000,000.00')).toBeNull();
    expect(parseDecimal('0000000000000000001.00')).not.toBeNull();
    expect(parsePlainNumber('1e400')).toBeNull();
    expect(parsePlainNumber('1E15')).toBeNull();
    expect(parsePlainNumber('1E14')).not.toBeNull();
    expect(parsePlainNumber('12345678901234567890', Number.POSITIVE_INFINITY)?.intDigits).toBe(
      '12345678901234567890',
    );
  });
});

describe('parsePlainNumber', () => {
  it.each([
    ['-690.85', -69085n],
    ['1180.0', 118000n],
    ['900', 90000n],
    ['1.5E3', 150000n],
    ['1.2345E2', 12345n],
    ['5E-2', 5n],
    ['-1E-2', -1n],
  ])('%s -> %s', (input, expected) => {
    expect(toMinor(parsePlainNumber(input)!, 2).minor).toBe(expected);
  });

  it('expands IDs written in exponent notation', () => {
    expect(parsePlainNumber('9.0000000001E10')).toEqual({
      negative: false,
      intDigits: '90000000001',
      fracDigits: '',
    });
  });

  it.each(['', '1,000', 'abc', '1.2.3', 'E5'])('rejects %j', (input) => {
    expect(parsePlainNumber(input)).toBeNull();
  });
});
