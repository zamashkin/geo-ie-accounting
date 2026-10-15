import { NBG_TIME_ZONE } from '@ie-ledger/nbg';
import type { PgBoss } from 'pg-boss';
import { defineJob, type JobDefinition } from '../define';
import { backfillRates } from './backfill';
import { defaultRatesDeps, type RatesDeps } from './deps';
import { syncRates } from './sync';

export { backfillRates, type BackfillSummary } from './backfill';
export { defaultRatesDeps, type RatesDeps } from './deps';
export { resolveRate } from './resolve';
export { syncRates, SYNC_LOOKBACK_DAYS } from './sync';

/** `rates.sync` and `rates.backfill`. `getDeps` is called per job, so deps are created lazily. */
export function createRatesJobs(getDeps: () => RatesDeps): JobDefinition[] {
  return [
    defineJob({
      name: 'rates.sync',
      // One queued and one running at most: overlapping syncs would fetch the same days.
      queue: { policy: 'stately' },
      handler: async (payload, { log }) => {
        const deps = getDeps();
        const s = await syncRates(deps, payload.currencies ?? deps.currencies, log);
        log.info({ ...s, conflicts: s.conflicts.length }, 'rates synced');
      },
    }),
    defineJob({
      name: 'rates.backfill',
      // Five years is ~1,800 NBG requests; give a long range time to finish.
      queue: { expireInSeconds: 3_600 },
      handler: async (payload, { log }) => {
        const deps = getDeps();
        const s = await backfillRates(deps, payload, log);
        await deps.publishBackfilled({
          currencies: payload.currencies,
          from: payload.from,
          to: payload.to,
        });
        log.info({ ...s, conflicts: s.conflicts.length }, 'rates backfilled');
      },
    }),
  ];
}

export const ratesJobs = createRatesJobs(defaultRatesDeps);

/**
 * NBG sets rates around 17:00 Tbilisi time (SPEC §2.3). Sync at 17:30, again at 20:00 in case
 * publication was late, and once at boot (ARCHITECTURE §8). Call after the queues exist.
 */
export const RATES_SYNC_SCHEDULES = [
  { key: 'after-publication', cron: '30 17 * * *' },
  { key: 'evening-retry', cron: '0 20 * * *' },
] as const;

export async function scheduleRatesSync(boss: PgBoss): Promise<void> {
  for (const { key, cron } of RATES_SYNC_SCHEDULES) {
    await boss.schedule('rates.sync', cron, {}, { tz: NBG_TIME_ZONE, key });
  }
  await boss.send('rates.sync', {});
}
