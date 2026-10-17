import type { RateSource } from '@geo-ie-accounting/db';
import { HttpProblem } from '../problem';

/** What the ledger routes need beyond the database, injected so tests never call NBG. */
export interface LedgerDeps {
  /** NBG rates for dates the database cannot prove (`resolveRate`). An `NbgClient` in production. */
  rates: RateSource;
  /** Clock for "today" (dashboard deadlines) and rate fetch times. */
  now: () => Date;
}

/** For the OpenAPI script and unit tests: any rate lookup that needs NBG fails with 503. */
export const offlineLedgerDeps: LedgerDeps = {
  rates: { getRates: () => Promise.reject(new HttpProblem(503, 'rate_unavailable')) },
  now: () => new Date(),
};
