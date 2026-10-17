import type { CurrencyCode, IsoDate } from '@geo-ie-accounting/contracts';
import {
  listRates,
  upsertRates,
  type NewExchangeRate,
  type RateConflict,
} from '@geo-ie-accounting/db';
import { eachDay, type NbgRate } from '@geo-ie-accounting/nbg';
import type { Logger } from 'pino';
import type { RatesDeps } from './deps';

/** Parallel NBG requests during a backfill. Small: NBG is a public service. */
const NBG_CONCURRENCY = 4;

export interface BackfillSummary {
  days: number;
  /** Dates actually requested from NBG (dates whose rate row already starts that day are skipped). */
  fetched: number;
  inserted: number;
  unchanged: number;
  conflicts: RateConflict[];
}

export function toNewRate(r: NbgRate): NewExchangeRate {
  return {
    currency: r.currency,
    validFrom: r.validFrom,
    rate: r.rate,
    quantity: r.quantity,
    setAt: new Date(r.setAt),
  };
}

/**
 * Days in [from, to] whose rate is not certainly known yet. A stored row that starts on a date
 * is exactly the rate for that date, so that date is skipped once every currency has one. Every
 * other date (weekends, holidays, gaps) is asked of NBG, which answers with the rate valid then.
 */
async function datesToFetch(
  deps: RatesDeps,
  from: IsoDate,
  to: IsoDate,
  currencies: readonly CurrencyCode[],
): Promise<IsoDate[]> {
  const days = eachDay(from, to);
  const startsByCurrency = await Promise.all(
    currencies.map(async (currency) => {
      const { items } = await listRates(deps.db, { currency, from, to, limit: days.length });
      return new Set(items.map((r) => r.validFrom));
    }),
  );
  return days.filter((d) => !startsByCurrency.every((starts) => starts.has(d)));
}

/**
 * Fetches the rate valid on every date in [from, to] and upserts it. Idempotent: running it again
 * for the same range inserts nothing and asks NBG only about days that start no stored rate.
 */
export async function backfillRates(
  deps: RatesDeps,
  { from, to, currencies }: { from: IsoDate; to: IsoDate; currencies: readonly CurrencyCode[] },
  log: Logger,
): Promise<BackfillSummary> {
  const dates = await datesToFetch(deps, from, to, currencies);
  const summary: BackfillSummary = {
    days: eachDay(from, to).length,
    fetched: dates.length,
    inserted: 0,
    unchanged: 0,
    conflicts: [],
  };

  for (let i = 0; i < dates.length; i += NBG_CONCURRENCY) {
    const batch = dates.slice(i, i + NBG_CONCURRENCY);
    const answers: NbgRate[][] = await Promise.all(
      batch.map((date) => deps.nbg.getRates(date, currencies)),
    );
    // Upsert per batch so a failure later in a long range keeps the progress made so far.
    const res = await upsertRates(deps.db, answers.flat().map(toNewRate), deps.now());
    summary.inserted += res.inserted;
    summary.unchanged += res.unchanged;
    summary.conflicts.push(...res.conflicts);
  }

  for (const c of summary.conflicts) {
    // Rates are public data, safe to log. The stored value is kept (see upsertRates).
    log.warn(c, 'NBG rate differs from the stored rate; keeping the stored one');
  }
  return summary;
}
