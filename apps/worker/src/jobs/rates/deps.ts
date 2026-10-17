import { CurrencyCode, type RatesBackfilledEvent } from '@geo-ie-accounting/contracts';
import { createDb, loadDbEnv, type Db } from '@geo-ie-accounting/db';
import { createNbgClient, type NbgClient } from '@geo-ie-accounting/nbg';
import { z } from 'zod';
import { publishEvent } from './events';

type RatesBackfilledData = z.input<typeof RatesBackfilledEvent>['data'];

/** Everything the rates jobs touch, injected so tests can swap NBG for recorded fixtures. */
export interface RatesDeps {
  db: Db;
  nbg: NbgClient;
  /** Currencies `rates.sync` fetches when the payload names none. */
  currencies: readonly CurrencyCode[];
  /** Publishes `rates.backfilled` to every org stream. */
  publishBackfilled: (data: RatesBackfilledData) => Promise<void>;
  now: () => Date;
}

const RatesEnv = z.object({
  /** Comma-separated ISO codes synced daily (SPEC §3 M1: USD, EUR, GBP by default). */
  RATES_CURRENCIES: z
    .string()
    .default('USD,EUR,GBP')
    .transform((s) => s.split(',').map((c) => c.trim()))
    .pipe(z.array(CurrencyCode).min(1)),
});

export function loadRatesEnv(env: NodeJS.ProcessEnv = process.env) {
  const result = RatesEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid rates environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let defaults: RatesDeps | undefined;

/**
 * Production dependencies, created on first use. The worker's JobContext carries no database
 * handle yet, so the rates jobs open a small pool of their own (see the WS-02 report).
 */
export function defaultRatesDeps(): RatesDeps {
  if (defaults) return defaults;
  const { db, pool } = createDb({
    connectionString: loadDbEnv().DATABASE_URL,
    max: 4,
    applicationName: 'geo-ie-accounting-worker-rates',
  });
  defaults = {
    db,
    nbg: createNbgClient(),
    currencies: loadRatesEnv().RATES_CURRENCIES,
    publishBackfilled: (data) => publishEvent(pool, { type: 'rates.backfilled', data }),
    now: () => new Date(),
  };
  return defaults;
}
