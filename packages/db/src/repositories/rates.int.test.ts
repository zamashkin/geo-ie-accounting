import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../testing/index';
import {
  getRateFor,
  latestValidFrom,
  listRates,
  sameDecimal,
  upsertRates,
  type NewExchangeRate,
} from './rates';

let tdb: TestDatabase;

// USD rates recorded in fixtures/nbg/ for 8-16 Oct 2026 (set times converted to UTC).
const usd = (validFrom: string, rate: string, setAt: string): NewExchangeRate => ({
  currency: 'USD',
  validFrom,
  rate,
  quantity: 1,
  setAt: new Date(setAt),
});
const OCT_2026: NewExchangeRate[] = [
  usd('2026-10-08', '2.6021', '2026-10-07T13:01:12.447Z'),
  usd('2026-10-09', '2.6019', '2026-10-08T13:01:14.467Z'),
  usd('2026-10-10', '2.6005', '2026-10-09T13:01:01.779Z'),
  usd('2026-10-13', '2.5994', '2026-10-12T13:01:08.293Z'),
  usd('2026-10-14', '2.5989', '2026-10-13T13:01:10.440Z'),
  usd('2026-10-16', '2.5987', '2026-10-15T13:01:15.076Z'),
  { currency: 'JPY', validFrom: '2026-10-14', rate: '1.6436', quantity: 100, setAt: null },
];

beforeAll(async () => {
  tdb = await startTestDatabase();
});

afterAll(async () => {
  await (tdb as TestDatabase | undefined)?.close();
});

async function countRates() {
  const { rows } = await tdb.db.execute<{ n: string }>(
    sql`select count(*)::text as n from exchange_rates`,
  );
  return Number(rows[0]!.n);
}

describe('upsertRates', () => {
  it('inserts new rows, then reports them unchanged on a second run', async () => {
    const first = await upsertRates(tdb.db, OCT_2026);
    expect(first).toEqual({ inserted: 7, unchanged: 0, conflicts: [] });
    const second = await upsertRates(tdb.db, OCT_2026);
    expect(second).toEqual({ inserted: 0, unchanged: 7, conflicts: [] });
    expect(await countRates()).toBe(7);
  });

  it('stores the rate as numeric(18,6) without float drift', async () => {
    const row = await getRateFor(tdb.db, 'USD', '2026-10-14');
    expect(row?.rate).toBe('2.598900');
    expect(row?.setAt?.toISOString()).toBe('2026-10-13T13:01:10.440Z');
  });

  it('collapses repeats within one call (weekend dates share a validFrom)', async () => {
    const saturday = OCT_2026[2]!;
    const res = await upsertRates(tdb.db, [saturday, saturday, saturday]);
    expect(res).toEqual({ inserted: 0, unchanged: 1, conflicts: [] });
  });

  it('keeps the stored rate and reports a conflict when NBG disagrees', async () => {
    const res = await upsertRates(tdb.db, [{ ...OCT_2026[0]!, rate: '2.7000' }]);
    expect(res.conflicts).toEqual([
      {
        currency: 'USD',
        validFrom: '2026-10-08',
        stored: { rate: '2.602100', quantity: 1 },
        fetched: { rate: '2.7000', quantity: 1 },
      },
    ]);
    expect((await getRateFor(tdb.db, 'USD', '2026-10-08'))?.rate).toBe('2.602100');
  });

  it('fills a missing set time without touching the rate', async () => {
    const jpy = OCT_2026[6]!;
    await upsertRates(tdb.db, [{ ...jpy, setAt: new Date('2026-10-13T13:01:10.440Z') }]);
    const row = await getRateFor(tdb.db, 'JPY', '2026-10-14');
    expect(row).toMatchObject({ rate: '1.643600', quantity: 100 });
    expect(row?.setAt?.toISOString()).toBe('2026-10-13T13:01:10.440Z');
  });
});

describe('getRateFor', () => {
  it.each([
    ['a weekday', '2026-10-09', '2026-10-09', '2.601900'],
    ['a Saturday', '2026-10-10', '2026-10-10', '2.600500'],
    ['a Sunday: the rate set on Friday evening', '2026-10-11', '2026-10-10', '2.600500'],
    ['a Monday: still Friday evening', '2026-10-12', '2026-10-10', '2.600500'],
    ['the day after the 14 Oct holiday', '2026-10-15', '2026-10-14', '2.598900'],
    ['a date after the newest row', '2026-12-31', '2026-10-16', '2.598700'],
  ])('resolves %s', async (_label, date, validFrom, rate) => {
    const row = await getRateFor(tdb.db, 'USD', date);
    expect(row).toMatchObject({ currency: 'USD', validFrom, rate });
  });

  it('returns null before the first row and for an unknown currency', async () => {
    expect(await getRateFor(tdb.db, 'USD', '2026-10-07')).toBeNull();
    expect(await getRateFor(tdb.db, 'CHF', '2026-10-14')).toBeNull();
  });
});

describe('listRates', () => {
  it('pages newest first with a keyset cursor', async () => {
    const seen: string[] = [];
    let after;
    for (let page = 0; page < 10; page++) {
      const res = await listRates(tdb.db, { limit: 3, after });
      seen.push(...res.items.map((r) => `${r.validFrom} ${r.currency}`));
      if (!res.next) break;
      after = res.next;
    }
    expect(seen).toEqual([
      '2026-10-16 USD',
      '2026-10-14 JPY',
      '2026-10-14 USD',
      '2026-10-13 USD',
      '2026-10-10 USD',
      '2026-10-09 USD',
      '2026-10-08 USD',
    ]);
  });

  it('filters by currency and inclusive date range', async () => {
    const res = await listRates(tdb.db, {
      currency: 'USD',
      from: '2026-10-10',
      to: '2026-10-14',
      limit: 50,
    });
    expect(res.items.map((r) => r.validFrom)).toEqual(['2026-10-14', '2026-10-13', '2026-10-10']);
    expect(res.next).toBeNull();
  });
});

describe('latestValidFrom', () => {
  it('gives the newest row per currency', async () => {
    const latest = await latestValidFrom(tdb.db, ['USD', 'JPY', 'CHF']);
    expect(Object.fromEntries(latest)).toEqual({ USD: '2026-10-16', JPY: '2026-10-14' });
  });
});

describe('sameDecimal', () => {
  it('compares decimal strings by value', () => {
    expect(sameDecimal('2.598900', '2.5989')).toBe(true);
    expect(sameDecimal('3.000000', '3')).toBe(true);
    expect(sameDecimal('0.014600', '0.0146')).toBe(true);
    expect(sameDecimal('2.5989', '2.5988')).toBe(false);
  });
});
