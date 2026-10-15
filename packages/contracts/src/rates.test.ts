import { describe, expect, it } from 'vitest';
import { BackfillRatesRequest, ListRatesQuery, RATES_BACKFILL_MAX_DAYS } from './rates';

describe('ListRatesQuery', () => {
  it('accepts an empty query with the default page size', () => {
    expect(ListRatesQuery.parse({})).toEqual({ limit: 50 });
  });

  it('accepts a currency and range', () => {
    const q = ListRatesQuery.parse({ currency: 'USD', from: '2026-10-01', to: '2026-10-15' });
    expect(q).toMatchObject({ currency: 'USD', from: '2026-10-01', to: '2026-10-15' });
  });

  it('rejects a reversed range and lowercase codes', () => {
    expect(ListRatesQuery.safeParse({ from: '2026-10-15', to: '2026-10-01' }).success).toBe(false);
    expect(ListRatesQuery.safeParse({ currency: 'usd' }).success).toBe(false);
  });
});

describe('BackfillRatesRequest', () => {
  const base = { from: '2026-10-01', to: '2026-10-15', currencies: ['USD'] };

  it('accepts a range', () => {
    expect(BackfillRatesRequest.parse(base)).toEqual(base);
  });

  it('accepts a single day', () => {
    expect(BackfillRatesRequest.safeParse({ ...base, to: base.from }).success).toBe(true);
  });

  it('rejects a reversed range, no currencies and over-long ranges', () => {
    expect(BackfillRatesRequest.safeParse({ ...base, from: '2026-10-16' }).success).toBe(false);
    expect(BackfillRatesRequest.safeParse({ ...base, currencies: [] }).success).toBe(false);
    const limit = RATES_BACKFILL_MAX_DAYS;
    // 2020-01-01 + (limit - 1) days is the last allowed `to`.
    const lastAllowed = new Date(Date.UTC(2020, 0, limit)).toISOString().slice(0, 10);
    const tooFar = new Date(Date.UTC(2020, 0, limit + 1)).toISOString().slice(0, 10);
    expect(
      BackfillRatesRequest.safeParse({ ...base, from: '2020-01-01', to: lastAllowed }).success,
    ).toBe(true);
    expect(
      BackfillRatesRequest.safeParse({ ...base, from: '2020-01-01', to: tooFar }).success,
    ).toBe(false);
  });
});
