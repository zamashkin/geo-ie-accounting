import { describe, expect, it } from 'vitest';
import { formatBp, formatIsoDate, formatMinor, formatPeriod, parseMinor } from './format';

// Intl puts a no-break space between the code and the amount.
const plain = (s: string) => s.replaceAll(String.fromCharCode(0xa0), ' ');

describe('formatMinor', () => {
  it('formats minor units exactly', () => {
    expect(plain(formatMinor('569866', 'GEL'))).toBe('GEL 5,698.66');
    expect(formatMinor('5699', 'GEL', { display: 'none' })).toBe('56.99');
    expect(plain(formatMinor('-69085', 'GBP'))).toBe('-GBP 690.85');
  });

  it('keeps amounts beyond 2^53 exact', () => {
    expect(formatMinor('900719925474099312', 'GEL', { display: 'none' })).toBe(
      '9,007,199,254,740,993.12',
    );
  });

  it('adds a plus sign on request', () => {
    expect(formatMinor('100', 'GEL', { display: 'none', signDisplay: 'exceptZero' })).toBe('+1.00');
    expect(formatMinor('0', 'GEL', { display: 'none', signDisplay: 'exceptZero' })).toBe('0.00');
  });

  it('rejects anything that is not an integer string', () => {
    expect(() => parseMinor('12.5')).toThrow(TypeError);
    expect(() => parseMinor('')).toThrow(TypeError);
    expect(parseMinor('-7')).toBe(-7n);
  });
});

describe('other formats', () => {
  it('formats basis points, periods and dates', () => {
    expect(formatBp(100)).toBe('1%');
    expect(formatBp(113)).toBe('1.13%');
    expect(formatPeriod('2025-06')).toBe('June 2025');
    expect(formatIsoDate('2025-07-15')).toBe('15 Jul 2025');
  });
});
