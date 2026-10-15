// Exchange-rate repository (WS-02). Rates are global, not tenant data: no orgId here.
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, max, or, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import { exchangeRates } from '../schema/index';

export type ExchangeRateRow = typeof exchangeRates.$inferSelect;

export interface NewExchangeRate {
  currency: string;
  /** NBG `validFromDate`, `YYYY-MM-DD`. */
  validFrom: string;
  /** Decimal string with at most 6 decimals, GEL per `quantity` units. */
  rate: string;
  quantity: number;
  setAt: Date | null;
}

/**
 * The rate valid on `date` (SPEC §2.3): the row with the greatest `valid_from <= date`. A Sunday
 * resolves to the row valid from Saturday, which NBG set on Friday evening. Returns null when no
 * row is old enough.
 *
 * This is a pure lookup. It cannot tell a weekend or holiday from a day the sync missed; callers
 * that need certainty use the worker's `resolveRate`, which asks NBG when the row does not start
 * on `date` (see apps/worker/src/jobs/rates).
 */
export async function getRateFor(
  db: DbOrTx,
  currency: string,
  date: string,
): Promise<ExchangeRateRow | null> {
  const [row] = await db
    .select()
    .from(exchangeRates)
    .where(and(eq(exchangeRates.currency, currency), lte(exchangeRates.validFrom, date)))
    .orderBy(desc(exchangeRates.validFrom))
    .limit(1);
  return row ?? null;
}

/** Same decimal value? String comparison after normalising: `"2.598900"` equals `"2.5989"`. */
export function sameDecimal(a: string, b: string): boolean {
  const norm = (s: string) => {
    const [int = '', frac = ''] = s.split('.');
    const i = int.replace(/^0+(?=\d)/, '');
    const f = frac.replace(/0+$/, '');
    return f ? `${i}.${f}` : i;
  };
  return norm(a) === norm(b);
}

export interface RateConflict {
  currency: string;
  validFrom: string;
  stored: { rate: string; quantity: number };
  fetched: { rate: string; quantity: number };
}

export interface UpsertRatesResult {
  inserted: number;
  /** Already stored with the same rate and quantity. */
  unchanged: number;
  /** Already stored with a different rate or quantity. The stored row is kept. */
  conflicts: RateConflict[];
}

const UPSERT_CHUNK = 500;

/**
 * Idempotent insert keyed on `(currency, valid_from)`. Running it twice with the same input
 * inserts nothing the second time. An existing row's rate and quantity are never overwritten:
 * postings reference rate rows as the snapshot they were converted with. A differing value is
 * returned as a conflict for the caller to report.
 */
export async function upsertRates(
  db: DbOrTx,
  rates: readonly NewExchangeRate[],
  fetchedAt: Date = new Date(),
): Promise<UpsertRatesResult> {
  // One INSERT cannot touch the same key twice, so drop repeats (first one wins).
  const byKey = new Map<string, NewExchangeRate>();
  for (const r of rates) {
    const key = `${r.currency}|${r.validFrom}`;
    if (!byKey.has(key)) byKey.set(key, r);
  }
  const unique = [...byKey.values()];
  const result: UpsertRatesResult = { inserted: 0, unchanged: 0, conflicts: [] };

  for (let i = 0; i < unique.length; i += UPSERT_CHUNK) {
    const chunk = unique.slice(i, i + UPSERT_CHUNK);
    const rows = await db
      .insert(exchangeRates)
      .values(chunk.map((r) => ({ ...r, source: 'nbg', fetchedAt })))
      .onConflictDoUpdate({
        target: [exchangeRates.currency, exchangeRates.validFrom],
        // Touch only bookkeeping columns so RETURNING reports the stored rate.
        set: {
          fetchedAt: sql`excluded.fetched_at`,
          setAt: sql`coalesce(${exchangeRates.setAt}, excluded.set_at)`,
        },
      })
      .returning({
        currency: exchangeRates.currency,
        validFrom: exchangeRates.validFrom,
        rate: exchangeRates.rate,
        quantity: exchangeRates.quantity,
        // xmax is 0 for a freshly inserted row version and non-zero after ON CONFLICT DO UPDATE.
        inserted: sql<boolean>`(xmax = 0)`,
      });
    for (const row of rows) {
      if (row.inserted) {
        result.inserted++;
        continue;
      }
      const input = byKey.get(`${row.currency}|${row.validFrom}`);
      if (!input) continue;
      if (sameDecimal(row.rate, input.rate) && row.quantity === input.quantity) {
        result.unchanged++;
      } else {
        result.conflicts.push({
          currency: row.currency,
          validFrom: row.validFrom,
          stored: { rate: row.rate, quantity: row.quantity },
          fetched: { rate: input.rate, quantity: input.quantity },
        });
      }
    }
  }
  return result;
}

/** Position in the `valid_from desc, currency asc` order of `listRates`. */
export interface RatesCursor {
  validFrom: string;
  currency: string;
}

export interface ListRatesOptions {
  currency?: string | undefined;
  /** Inclusive bounds on `valid_from`. */
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
  after?: RatesCursor | undefined;
}

/** Rates newest first, keyset-paginated. */
export async function listRates(
  db: DbOrTx,
  opts: ListRatesOptions,
): Promise<{ items: ExchangeRateRow[]; next: RatesCursor | null }> {
  const where: (SQL | undefined)[] = [
    opts.currency ? eq(exchangeRates.currency, opts.currency) : undefined,
    opts.from ? gte(exchangeRates.validFrom, opts.from) : undefined,
    opts.to ? lte(exchangeRates.validFrom, opts.to) : undefined,
    opts.after
      ? or(
          lt(exchangeRates.validFrom, opts.after.validFrom),
          and(
            eq(exchangeRates.validFrom, opts.after.validFrom),
            gt(exchangeRates.currency, opts.after.currency),
          ),
        )
      : undefined,
  ];
  const rows = await db
    .select()
    .from(exchangeRates)
    .where(and(...where))
    .orderBy(desc(exchangeRates.validFrom), asc(exchangeRates.currency))
    .limit(opts.limit + 1);
  const items = rows.slice(0, opts.limit);
  const last = items.at(-1);
  return {
    items,
    next:
      rows.length > opts.limit && last
        ? { validFrom: last.validFrom, currency: last.currency }
        : null,
  };
}

/** Latest stored `valid_from` per currency; currencies with no rows are absent from the map. */
export async function latestValidFrom(
  db: DbOrTx,
  currencies: readonly string[],
): Promise<Map<string, string>> {
  if (currencies.length === 0) return new Map();
  const rows = await db
    .select({ currency: exchangeRates.currency, latest: max(exchangeRates.validFrom) })
    .from(exchangeRates)
    .where(inArray(exchangeRates.currency, [...currencies]))
    .groupBy(exchangeRates.currency);
  return new Map(rows.flatMap((r) => (r.latest ? [[r.currency, r.latest] as const] : [])));
}
