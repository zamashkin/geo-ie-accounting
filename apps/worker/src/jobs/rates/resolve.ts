import type { CurrencyCode, IsoDate } from '@ie-ledger/contracts';
import { getRateFor, upsertRates, type ExchangeRateRow } from '@ie-ledger/db';
import { toNewRate } from './backfill';
import type { RatesDeps } from './deps';

/**
 * The rate valid on `date`, fetched from NBG when the database cannot prove it (SPEC §2.3).
 *
 * `getRateFor` returns the newest row with `valid_from <= date`. When that row starts exactly on
 * `date` it is certainly right. Otherwise `date` is a weekend or holiday, or the sync missed a
 * day, and the stored data cannot tell which, so NBG is asked for `date` and the answer stored.
 *
 * Does network I/O: call it before opening a database transaction, not inside one (import.commit
 * resolves every booked date of a chunk first).
 */
export async function resolveRate(
  deps: Pick<RatesDeps, 'db' | 'nbg' | 'now'>,
  currency: CurrencyCode,
  date: IsoDate,
): Promise<ExchangeRateRow> {
  const stored = await getRateFor(deps.db, currency, date);
  if (stored?.validFrom === date) return stored;

  // getRates throws NbgMissingCurrencyError when NBG has no rate, so this is never empty.
  const rates = await deps.nbg.getRates(date, [currency]);
  await upsertRates(deps.db, rates.map(toNewRate), deps.now());
  const row = await getRateFor(deps.db, currency, date);
  if (!row) throw new Error(`No ${currency} rate stored for ${date} after fetching it`);
  return row;
}
