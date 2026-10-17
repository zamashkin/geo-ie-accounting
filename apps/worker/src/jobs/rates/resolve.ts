import type { CurrencyCode, IsoDate } from '@geo-ie-accounting/contracts';
import { resolveRate as resolveStoredRate, type ExchangeRateRow } from '@geo-ie-accounting/db';
import type { RatesDeps } from './deps';

/**
 * The rate valid on `date`, fetched from NBG when the database cannot prove it (SPEC §2.3).
 * Thin wrapper over `resolveRate` in packages/db, which the API's import commit uses too.
 *
 * Does network I/O: call it before opening a database transaction, not inside one.
 */
export function resolveRate(
  deps: Pick<RatesDeps, 'db' | 'nbg' | 'now'>,
  currency: CurrencyCode,
  date: IsoDate,
): Promise<ExchangeRateRow> {
  return resolveStoredRate(deps.db, deps.nbg, currency, date, deps.now());
}
