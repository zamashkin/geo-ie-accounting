import type { CurrencyCode } from '@geo-ie-accounting/contracts';
import { latestValidFrom } from '@geo-ie-accounting/db';
import { addDays, tbilisiDate } from '@geo-ie-accounting/nbg';
import type { Logger } from 'pino';
import { backfillRates, type BackfillSummary } from './backfill';
import type { RatesDeps } from './deps';

/** How far back a sync reaches to close a gap left by downtime. Longer gaps need a backfill. */
export const SYNC_LOOKBACK_DAYS = 31;

/**
 * Daily sync (ARCHITECTURE §8). Fetches every day from the day after the newest stored rate up to
 * tomorrow in Tbilisi, so the rate NBG sets around 17:00 (valid from tomorrow) is picked up and a
 * worker that was down for a few days catches up. With no rows yet it starts from today.
 */
export async function syncRates(
  deps: RatesDeps,
  currencies: readonly CurrencyCode[],
  log: Logger,
): Promise<BackfillSummary & { from: string; to: string }> {
  const today = tbilisiDate(deps.now());
  const to = addDays(today, 1);
  const earliest = addDays(to, -SYNC_LOOKBACK_DAYS);
  const latest = await latestValidFrom(deps.db, currencies);
  let from = to;
  for (const currency of currencies) {
    const stored = latest.get(currency);
    const start = stored ? addDays(stored, 1) : today;
    if (start < from) from = start;
  }
  if (from < earliest) {
    log.warn({ from, earliest }, 'rates gap is older than the sync lookback; run rates.backfill');
    from = earliest;
  }
  const summary = await backfillRates(deps, { from, to, currencies }, log);
  if (summary.inserted > 0) await deps.publishBackfilled({ currencies: [...currencies], from, to });
  return { ...summary, from, to };
}
