import type { JobPayload } from '@ie-ledger/contracts';
import { listRates, type Db, type ExchangeRateRow, type ListRatesOptions } from '@ie-ledger/db';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';

/** What the /v1/rates routes need, injected so route tests run without Postgres. */
export interface RatesRouteDeps {
  listRates: (
    opts: ListRatesOptions,
  ) => Promise<{ items: ExchangeRateRow[]; next: ListRatesOptions['after'] | null }>;
  /** Returns the pg-boss job id. Throws `QueueUnavailableError` if the queue cannot take it. */
  enqueueBackfill: (payload: JobPayload<'rates.backfill'>) => Promise<string>;
  /**
   * STUB(WS-05): shared secret for the admin-only backfill route, sent as `x-admin-token`.
   * Undefined disables the route. Replace with the real admin role check once auth lands.
   */
  adminToken: string | undefined;
  close?: () => Promise<void>;
}

export class QueueUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The job queue is unavailable', { cause });
    this.name = 'QueueUnavailableError';
  }
}

const RatesRouteEnv = z.object({
  /** STUB(WS-05): see RatesRouteDeps.adminToken. At least 32 characters when set. */
  ADMIN_TOKEN: z.string().min(32).optional(),
});

export function loadRatesRouteEnv(env: NodeJS.ProcessEnv = process.env) {
  const result = RatesRouteEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid rates API environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * Production deps: rates from Postgres, backfills sent to pg-boss. The pg-boss client is send-only
 * (no maintenance, no cron) and starts on the first backfill request.
 */
export function createRatesRouteDeps({
  db,
  connectionString,
  env = process.env,
}: {
  db: Db;
  connectionString: string;
  env?: NodeJS.ProcessEnv;
}): RatesRouteDeps {
  const { ADMIN_TOKEN } = loadRatesRouteEnv(env);
  let boss: Promise<PgBoss> | undefined;

  const getBoss = () =>
    (boss ??= (async () => {
      const b = new PgBoss({
        connectionString,
        application_name: 'ie-ledger-api',
        supervise: false,
        schedule: false,
      });
      b.on('error', () => undefined); // surfaced through the failing send() instead
      await b.start();
      return b;
    })().catch((err: unknown) => {
      boss = undefined;
      throw err;
    }));

  return {
    listRates: (opts) => listRates(db, opts),
    enqueueBackfill: async (payload) => {
      try {
        const id = await (await getBoss()).send('rates.backfill', payload);
        if (!id) throw new Error('pg-boss did not create the job');
        return id;
      } catch (err) {
        throw new QueueUnavailableError(err);
      }
    },
    adminToken: ADMIN_TOKEN,
    close: async () => {
      const started = await boss?.catch(() => undefined);
      await started?.stop({ graceful: false });
    },
  };
}
