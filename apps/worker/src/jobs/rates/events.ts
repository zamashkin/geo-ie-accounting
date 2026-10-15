import { randomUUID } from 'node:crypto';
import { EVENTS_NOTIFY_CHANNEL, NotifyPayload, type OrgEvent } from '@ie-ledger/contracts';
import type { z } from 'zod';

type RatesEvent = Extract<z.input<typeof OrgEvent>, { type: 'rates.backfilled' }>;

/** Anything with node-postgres' `query(text, values)`: a Pool or a client. */
export interface Queryable {
  query(text: string, values: unknown[]): Promise<unknown>;
}

/**
 * Broadcasts a rates event over Postgres NOTIFY (ADR 0005). Rates are not org data, so `orgId`
 * is null and the API fans the event out to every org stream.
 */
export async function publishEvent(pg: Queryable, event: Pick<RatesEvent, 'type' | 'data'>) {
  const payload = NotifyPayload.parse({
    orgId: null,
    event: {
      // The SSE layer owns stream ordering; this id only has to be unique.
      id: randomUUID(),
      at: new Date().toISOString(),
      ...event,
    },
  });
  await pg.query('select pg_notify($1, $2)', [EVENTS_NOTIFY_CHANNEL, JSON.stringify(payload)]);
}
