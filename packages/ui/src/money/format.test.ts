import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatMoneyToParts,
  minorToDecimalString,
  minorToInputText,
  parseMoneyInput,
  toMinor,
} from './format';

describe('minorToDecimalString', () => {
  it.each([
    [125000n, 2, '1250.00'],
    [5n, 2, '0.05'],
    [-69085n, 2, '-690.85'],
    [0n, 2, '0.00'],
    [-1n, 2, '-0.01'],
    [1234n, 0, '1234'],
    [1234n, 3, '1.234'],
  ])('%s with exponent %s -> %s', (minor, exp, expected) => {
    expect(minorToDecimalString(minor, exp)).toBe(expected);
  });

  it('keeps precision far beyond Number.MAX_SAFE_INTEGER', () => {
    expect(minorToDecimalString(9_223_372_036_854_775_807n, 2)).toBe('92233720368547758.07');
  });
});

describe('toMinor', () => {
  it('parses the wire form', () => {
    expect(toMinor('-69085')).toBe(-69085n);
  });

  it('rejects decimals', () => {
    expect(() => toMinor('12.50')).toThrow(TypeError);
  });
});

describe('formatMoney', () => {
  it('formats with the currency code by default', () => {
    // Intl puts a no-break space between the code and the number.
    expect(formatMoney(125000n, 'GEL')).toBe('GEL\u00a01,250.00');
  });

  it('accepts the wire string', () => {
    expect(formatMoney('-69085', 'USD')).toBe('-USD\u00a0690.85');
  });

  it('formats huge amounts exactly', () => {
    expect(formatMoney(9_223_372_036_854_775_807n, 'GEL', { currencyDisplay: 'none' })).toBe(
      '92,233,720,368,547,758.07',
    );
  });

  it('can show a sign for deltas', () => {
    expect(formatMoney(150n, 'EUR', { signDisplay: 'always', currencyDisplay: 'none' })).toBe(
      '+1.50',
    );
  });

  it('respects zero-decimal currencies', () => {
    expect(formatMoney(1500n, 'JPY', { currencyDisplay: 'none' })).toBe('1,500');
  });

  it('exposes the currency as a separate part', () => {
    const parts = formatMoneyToParts(100n, 'GBP');
    expect(parts.find((p) => p.type === 'currency')?.value).toBe('GBP');
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['1250', 125000n],
    ['1,250.5', 125050n],
    ['1 250.50', 125050n],
    ['12.', 1200n],
    ['.5', 50n],
    ['0.01', 1n],
    ['  7 ', 700n],
  ])('parses %j', (text, minor) => {
    expect(parseMoneyInput(text, 'GEL')).toEqual({ ok: true, amountMinor: minor });
  });

  it('parses beyond float precision', () => {
    expect(parseMoneyInput('90071992547409.93', 'USD')).toEqual({
      ok: true,
      amountMinor: 9007199254740993n,
    });
  });

  it.each([
    ['', 'empty'],
    ['-', 'empty'],
    ['abc', 'invalid'],
    ['1.2.3', 'invalid'],
    ['.', 'invalid'],
    ['1e5', 'invalid'],
    ['1.234', 'too_many_decimals'],
    ['-5', 'negative'],
  ])('rejects %j as %s', (text, reason) => {
    expect(parseMoneyInput(text, 'GEL')).toEqual({ ok: false, reason });
  });

  it('allows negatives when asked', () => {
    expect(parseMoneyInput('-5.5', 'GEL', { allowNegative: true })).toEqual({
      ok: true,
      amountMinor: -550n,
    });
  });

  it('uses the currency exponent', () => {
    expect(parseMoneyInput('1.5', 'JPY')).toEqual({ ok: false, reason: 'too_many_decimals' });
    expect(parseMoneyInput('1.234', 'KWD')).toEqual({ ok: true, amountMinor: 1234n });
  });
});

describe('minorToInputText', () => {
  it('round-trips with parseMoneyInput', () => {
    for (const minor of [0n, 1n, 99n, 125050n, 9007199254740993n]) {
      const text = minorToInputText(minor, 'GEL');
      expect(parseMoneyInput(text, 'GEL')).toEqual({ ok: true, amountMinor: minor });
    }
  });
});
