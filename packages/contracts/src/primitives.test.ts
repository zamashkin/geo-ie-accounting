import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { IsoDate, MinorUnits, Money, Period, RateDecimal } from './primitives';

describe('MinorUnits', () => {
  it('decodes integer strings to bigint', () => {
    expect(MinorUnits.parse('125000')).toBe(125000n);
    expect(MinorUnits.parse('-69085')).toBe(-69085n);
    expect(MinorUnits.parse('0')).toBe(0n);
  });

  it('keeps precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(MinorUnits.parse('9223372036854775807')).toBe(9223372036854775807n);
  });

  it('encodes bigint back to the same string', () => {
    expect(z.encode(MinorUnits, 125000n)).toBe('125000');
    expect(z.encode(MinorUnits, -1n)).toBe('-1');
  });

  it.each([
    ['number', 125000],
    ['decimal string', '1250.00'],
    ['leading zero', '0125'],
    ['plus sign', '+5'],
    ['negative zero', '-0'],
    ['empty', ''],
    ['exponent', '1e5'],
    ['whitespace', ' 1'],
    ['above int64', '9223372036854775808'],
  ])('rejects %s', (_label, input) => {
    expect(MinorUnits.safeParse(input).success).toBe(false);
  });
});

describe('Money', () => {
  it('round-trips JSON', () => {
    const json = { amountMinor: '118000', currency: 'GBP' };
    const money = Money.parse(json);
    expect(money).toEqual({ amountMinor: 118000n, currency: 'GBP' });
    expect(JSON.stringify(z.encode(Money, money))).toBe(JSON.stringify(json));
  });

  it('rejects lower-case currency codes', () => {
    expect(Money.safeParse({ amountMinor: '1', currency: 'usd' }).success).toBe(false);
  });

  it('describes the wire format as a string in JSON Schema', () => {
    const schema = z.toJSONSchema(Money, { io: 'input' });
    expect(schema.properties?.amountMinor).toMatchObject({ type: 'string' });
  });
});

describe('dates and rates', () => {
  it('validates ISO dates and periods', () => {
    expect(IsoDate.safeParse('2025-06-04').success).toBe(true);
    expect(IsoDate.safeParse('04.06.2025').success).toBe(false);
    expect(Period.safeParse('2026-09').success).toBe(true);
    expect(Period.safeParse('2026-13').success).toBe(false);
  });

  it('accepts NBG-style rates with up to 6 decimals', () => {
    expect(RateDecimal.safeParse('3.6924').success).toBe(true);
    expect(RateDecimal.safeParse('1.302736').success).toBe(true);
    expect(RateDecimal.safeParse('1.3027361').success).toBe(false);
    expect(RateDecimal.safeParse('-1').success).toBe(false);
  });
});
