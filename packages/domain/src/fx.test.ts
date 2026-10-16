import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, InvalidRateError, MissingRateError } from './errors';
import { compareBankGel, formatRate, parseRate, RATE_SCALE, toGel } from './fx';
import type { FxRate } from './fx';
import { money, negate, sum } from './money';
import { ROUNDING_MODES } from './rounding';
import type { RoundingMode } from './rounding';

const usdRate: FxRate = { rateScaled: parseRate('2.7123'), quantity: 1, currency: 'USD' };

describe('parseRate / formatRate', () => {
  it('scales NBG rates by 10^6', () => {
    expect(RATE_SCALE).toBe(1_000_000n);
    expect(parseRate('2.7123')).toBe(2_712_300n);
    expect(parseRate('2.712300')).toBe(2_712_300n);
    expect(parseRate('3')).toBe(3_000_000n);
    expect(parseRate('0.000001')).toBe(1n);
  });

  it.each(['0', '0.000000', '-2.7', '2.7123456', 'abc', ''])('rejects %j', (input) => {
    expect(() => parseRate(input)).toThrow(InvalidRateError);
  });

  it.each([
    [2_712_300n, '2.7123'],
    [3_000_000n, '3'],
    [30_000_000n, '30'],
    [1n, '0.000001'],
    [1_825_610n, '1.82561'],
  ])('formatRate(%s) = %s', (scaled, text) => {
    expect(formatRate(scaled)).toBe(text);
  });
});

describe('toGel', () => {
  it('converts 1,000.00 USD at 2.7123 to 2,712.30 GEL', () => {
    expect(toGel(money(100_000n, 'USD'), usdRate)).toEqual(money(271_230n, 'GEL'));
  });

  it('keeps the sign of credits', () => {
    expect(toGel(money(-100_000n, 'USD'), usdRate)).toEqual(money(-271_230n, 'GEL'));
  });

  it('divides by quantity (rate per 100 units)', () => {
    // 100 JPY = 1.8256 GEL; 10,000 JPY → 182.56 GEL. JPY has no minor units.
    const jpy: FxRate = { rateScaled: parseRate('1.8256'), quantity: 100 };
    expect(toGel(money(10_000n, 'JPY'), jpy)).toEqual(money(18_256n, 'GEL'));
  });

  it('accounts for a three-decimal source currency', () => {
    // 1.000 KWD at 8.8 GEL → 8.80 GEL
    expect(toGel(money(1000n, 'KWD'), { rateScaled: parseRate('8.8'), quantity: 1 })).toEqual(
      money(880n, 'GEL'),
    );
  });

  it('rounds the GEL figure with the configured mode (half-even by default)', () => {
    // 0.05 USD × 2.7 = 0.135 GEL: a tie between 13 and 14 tetri.
    const rate = { rateScaled: parseRate('2.7'), quantity: 1 };
    expect(toGel(money(5n, 'USD'), rate).amountMinor).toBe(14n);
    expect(toGel(money(5n, 'USD'), rate, 'half_down').amountMinor).toBe(13n);
    // 0.25 USD × 2.7 = 0.675 → 0.68 (even) under half-even.
    expect(toGel(money(25n, 'USD'), rate).amountMinor).toBe(68n);
    expect(toGel(money(-5n, 'USD'), rate, 'floor').amountMinor).toBe(-14n);
  });

  it('returns GEL unchanged and needs no rate for it', () => {
    expect(toGel(money(12_345n, 'GEL'))).toEqual(money(12_345n, 'GEL'));
    expect(toGel(money(12_345n, 'GEL'), usdRate)).toEqual(money(12_345n, 'GEL'));
  });

  it('throws typed errors for a missing, mismatched or invalid rate', () => {
    expect(() => toGel(money(1n, 'USD'))).toThrow(MissingRateError);
    expect(() => toGel(money(1n, 'USD'), null)).toThrow(
      expect.objectContaining({ code: 'missing_rate', currency: 'USD' }),
    );
    expect(() => toGel(money(1n, 'EUR'), usdRate)).toThrow(CurrencyMismatchError);
    expect(() => toGel(money(1n, 'USD'), { rateScaled: 0n, quantity: 1 })).toThrow(
      InvalidRateError,
    );
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expect(() => toGel(money(1n, 'USD'), { rateScaled: 1n, quantity })).toThrow(InvalidRateError);
    }
  });

  const rateArb = fc.record({
    rateScaled: fc.bigInt({ min: 1n, max: 1_000n * RATE_SCALE }),
    quantity: fc.constantFrom(1, 10, 100, 1000),
  });
  const amountsArb = fc.array(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), {
    minLength: 1,
    maxLength: 50,
  });

  it('property: toGel of a sum differs from the sum of toGel by at most n−1 tetri', () => {
    fc.assert(
      fc.property(
        amountsArb,
        rateArb,
        fc.constantFrom(...ROUNDING_MODES),
        (amounts, rate, mode) => {
          const items = amounts.map((a) => money(a, 'USD'));
          const ofSum = toGel(sum('USD', items), rate, mode).amountMinor;
          const sumOf = sum(
            'GEL',
            items.map((m) => toGel(m, rate, mode)),
          ).amountMinor;
          const diff = ofSum > sumOf ? ofSum - sumOf : sumOf - ofSum;
          expect(diff <= BigInt(Math.max(0, items.length - 1))).toBe(true);
        },
      ),
    );
  });

  it('property: symmetric modes convert a negated amount to the negated GEL figure', () => {
    const symmetric: RoundingMode[] = ['half_even', 'half_up', 'half_down', 'up', 'down'];
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        rateArb,
        fc.constantFrom(...symmetric),
        (amount, rate, mode) => {
          const m = money(amount, 'EUR');
          expect(toGel(negate(m), rate, mode)).toEqual(negate(toGel(m, rate, mode)));
        },
      ),
    );
  });
});

describe('compareBankGel', () => {
  const gel = (minor: bigint) => money(minor, 'GEL');

  it('accepts the bank figure when it is within one tetri of ours', () => {
    expect(compareBankGel(gel(435703n), 435703n)).toBeNull();
    expect(compareBankGel(gel(435703n), 435704n)).toBeNull();
    expect(compareBankGel(gel(-255255n), -255254n)).toBeNull();
  });

  it('reports a difference of more than one tetri, signed bank minus ours', () => {
    expect(compareBankGel(gel(435703n), 435705n)).toEqual({
      gelAmountMinor: 435703n,
      bankGelAmountMinor: 435705n,
      differenceMinor: 2n,
    });
    expect(compareBankGel(gel(-255255n), -255000n)).toMatchObject({ differenceMinor: 255n });
    // A sign error at the bank is a difference too.
    expect(compareBankGel(gel(100n), -100n)).toMatchObject({ differenceMinor: -200n });
  });

  it('has nothing to compare when the statement has no GEL column', () => {
    expect(compareBankGel(gel(435703n), null)).toBeNull();
  });

  it('only compares GEL amounts', () => {
    expect(() => compareBankGel(money(118000n, 'GBP'), 435703n)).toThrow(CurrencyMismatchError);
  });

  it('agrees with the BoG fixture: GBP 1,180.00 at 3.6924 is the bank’s GEL 4,357.03', () => {
    const ours = toGel(money(118000n, 'GBP'), { rateScaled: parseRate('3.6924'), quantity: 1 });
    expect(compareBankGel(ours, 435703n)).toBeNull();
  });
});
