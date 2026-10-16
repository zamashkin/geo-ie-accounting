import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assertSupportedCurrency,
  BASE_CURRENCY,
  CURRENCIES,
  isCurrencyCode,
  isSupportedCurrency,
  iso4217Exponent,
  minorUnitExponent,
  SUPPORTED_CURRENCIES,
} from './currency';
import {
  AmountOutOfRangeError,
  CurrencyMismatchError,
  InvalidAmountError,
  UnsupportedCurrencyError,
} from './errors';
import {
  abs,
  add,
  compare,
  equals,
  formatDecimal,
  INT64_MAX,
  INT64_MIN,
  isNegative,
  isPositive,
  isZero,
  money,
  negate,
  parseDecimal,
  parseMoney,
  subtract,
  sum,
  toDecimalString,
  zero,
} from './money';

const usd = (n: bigint) => money(n, 'USD');
const gel = (n: bigint) => money(n, 'GEL');

describe('currency', () => {
  it('has GEL, USD, EUR and GBP with 2 decimals (ARCHITECTURE §3)', () => {
    for (const code of ['GEL', 'USD', 'EUR', 'GBP']) expect(minorUnitExponent(code)).toBe(2);
    expect(BASE_CURRENCY).toBe('GEL');
  });

  it('knows zero- and three-decimal currencies', () => {
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KWD')).toBe(3);
  });

  it('rejects unknown codes with a typed error', () => {
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(isSupportedCurrency('toString')).toBe(false);
    expect(() => minorUnitExponent('XYZ')).toThrow(UnsupportedCurrencyError);
    expect(() => {
      assertSupportedCurrency('usd');
    }).toThrow(expect.objectContaining({ code: 'unsupported_currency', currency: 'usd' }));
  });

  it('lists every currency in the table', () => {
    expect(SUPPORTED_CURRENCIES).toEqual(Object.keys(CURRENCIES));
  });
});

describe('ISO 4217 codes outside the ledger', () => {
  it('checks the shape of a code only', () => {
    expect(isCurrencyCode('XYZ')).toBe(true);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(isCurrencyCode('GBPX')).toBe(false);
  });

  it('agrees with minorUnitExponent on every supported currency', () => {
    for (const code of SUPPORTED_CURRENCIES) {
      expect(iso4217Exponent(code)).toBe(minorUnitExponent(code));
    }
  });

  it('knows 0- and 3-decimal currencies the ledger does not hold, else 2, and never throws', () => {
    expect(iso4217Exponent('KRW')).toBe(0);
    expect(iso4217Exponent('BHD')).toBe(3);
    expect(iso4217Exponent('RUB')).toBe(2);
    expect(iso4217Exponent('XYZ')).toBe(2);
    expect(iso4217Exponent('toString')).toBe(2);
  });
});

describe('money arithmetic', () => {
  it('adds, subtracts, negates and compares within one currency', () => {
    expect(add(usd(150n), usd(-50n))).toEqual(usd(100n));
    expect(subtract(usd(150n), usd(200n))).toEqual(usd(-50n));
    expect(negate(usd(7n))).toEqual(usd(-7n));
    expect(abs(usd(-7n))).toEqual(usd(7n));
    expect(abs(usd(7n))).toEqual(usd(7n));
    expect(compare(usd(1n), usd(2n))).toBe(-1);
    expect(compare(usd(2n), usd(2n))).toBe(0);
    expect(compare(usd(3n), usd(2n))).toBe(1);
    expect(isZero(zero('GEL'))).toBe(true);
    expect(isNegative(usd(-1n))).toBe(true);
    expect(isPositive(usd(1n))).toBe(true);
    expect(isPositive(usd(0n))).toBe(false);
  });

  it('throws CurrencyMismatchError across currencies', () => {
    expect(() => add(usd(1n), gel(1n))).toThrow(CurrencyMismatchError);
    expect(() => subtract(usd(1n), gel(1n))).toThrow(CurrencyMismatchError);
    expect(() => compare(usd(1n), gel(1n))).toThrow(
      expect.objectContaining({ code: 'currency_mismatch', expected: 'USD', actual: 'GEL' }),
    );
  });

  it('equals is false across currencies instead of throwing', () => {
    expect(equals(usd(1n), gel(1n))).toBe(false);
    expect(equals(usd(1n), usd(1n))).toBe(true);
  });

  it('sums with an explicit currency, including an empty list', () => {
    expect(sum('GEL', [])).toEqual(gel(0n));
    expect(sum('USD', [usd(1n), usd(2n), usd(-4n)])).toEqual(usd(-1n));
    expect(() => sum('USD', [usd(1n), gel(1n)])).toThrow(CurrencyMismatchError);
  });

  it('rejects amounts outside Postgres bigint', () => {
    expect(money(INT64_MAX, 'GEL').amountMinor).toBe(INT64_MAX);
    expect(money(INT64_MIN, 'GEL').amountMinor).toBe(INT64_MIN);
    expect(() => money(INT64_MAX + 1n, 'GEL')).toThrow(AmountOutOfRangeError);
    expect(() => add(gel(INT64_MAX), gel(1n))).toThrow(
      expect.objectContaining({ code: 'amount_out_of_range' }),
    );
    expect(() => negate(gel(INT64_MIN))).toThrow(AmountOutOfRangeError);
  });

  it('rejects unsupported currencies', () => {
    expect(() => money(1n, 'XYZ')).toThrow(UnsupportedCurrencyError);
    expect(() => sum('XYZ', [])).toThrow(UnsupportedCurrencyError);
  });

  it('property: sum equals repeated add and is order-independent', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n })), (amounts) => {
        const items = amounts.map(usd);
        const folded = items.reduce(add, zero('USD'));
        expect(sum('USD', items)).toEqual(folded);
        expect(sum('USD', [...items].reverse())).toEqual(folded);
      }),
    );
  });
});

describe('decimal strings', () => {
  it.each([
    ['1000.50', 2, 100050n],
    ['1000.5', 2, 100050n],
    ['1000', 2, 100000n],
    ['-0.07', 2, -7n],
    ['-0', 2, 0n],
    ['007.10', 2, 710n],
    ['12.3400', 2, 1234n],
    ['15', 0, 15n],
    ['1.234', 3, 1234n],
    ['92233720368547758.07', 2, INT64_MAX],
  ])('parseDecimal(%s, %i) = %s', (input, exponent, expected) => {
    expect(parseDecimal(input, exponent)).toBe(expected);
  });

  it.each(['', '-', '.5', '1.', '1,000.00', '1e3', '+1', ' 1', '1.0 ', 'NaN', '1.2.3'])(
    'rejects %j',
    (input) => {
      expect(() => parseDecimal(input, 2)).toThrow(InvalidAmountError);
    },
  );

  it('rejects precision the currency cannot hold', () => {
    expect(() => parseDecimal('1.005', 2)).toThrow(/more than 2 decimal places/);
    expect(() => parseDecimal('1.5', 0)).toThrow(InvalidAmountError);
  });

  it.each([
    [100050n, 2, '1000.50'],
    [-7n, 2, '-0.07'],
    [0n, 2, '0.00'],
    [5n, 0, '5'],
    [-1234n, 3, '-1.234'],
  ])('formatDecimal(%s, %i) = %s', (value, exponent, expected) => {
    expect(formatDecimal(value, exponent)).toBe(expected);
  });

  it('parses and prints money with the currency exponent', () => {
    expect(parseMoney('1000.50', 'USD')).toEqual(usd(100050n));
    expect(parseMoney('1000', 'JPY')).toEqual(money(1000n, 'JPY'));
    expect(toDecimalString(money(1234n, 'KWD'))).toBe('1.234');
    expect(() => parseMoney('1.00', 'XYZ')).toThrow(UnsupportedCurrencyError);
  });

  it('property: formatDecimal and parseDecimal round-trip', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: INT64_MIN, max: INT64_MAX }),
        fc.integer({ min: 0, max: 6 }),
        (value, exponent) => {
          expect(parseDecimal(formatDecimal(value, exponent), exponent)).toBe(value);
        },
      ),
    );
  });
});
