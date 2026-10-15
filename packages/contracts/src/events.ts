import { z } from 'zod';
import { ImportBatchStats } from './entities';
import { ImportBatchStatus } from './enums';
import { CurrencyCode, IsoDate, Timestamp, Uuid } from './primitives';

// Server-Sent Events on GET /v1/orgs/:orgId/events (ADR 0005). The SSE `event:` field is `type`,
// the SSE `id:` field is `id` (for Last-Event-ID), and `data:` is the JSON of the whole event.

const envelope = {
  /** Monotonic per stream; used for Last-Event-ID. */
  id: z.string(),
  at: Timestamp,
};

export const ImportProgressEvent = z.object({
  ...envelope,
  type: z.literal('import.progress'),
  data: z.object({
    batchId: Uuid,
    phase: z.enum(['parse', 'commit']),
    processed: z.int().nonnegative(),
    total: z.int().nonnegative().nullable(),
  }),
});

export const ImportCompletedEvent = z.object({
  ...envelope,
  type: z.literal('import.completed'),
  data: z.object({
    batchId: Uuid,
    status: ImportBatchStatus,
    stats: ImportBatchStats.partial(),
  }),
});

/** Not org-specific: fanned out to every connected org stream. */
export const RatesBackfilledEvent = z.object({
  ...envelope,
  type: z.literal('rates.backfilled'),
  data: z.object({
    currencies: z.array(CurrencyCode),
    from: IsoDate,
    to: IsoDate,
  }),
});

export const InvoicePdfReadyEvent = z.object({
  ...envelope,
  type: z.literal('invoice.pdf_ready'),
  data: z.object({ invoiceId: Uuid }),
});

export const OrgEvent = z
  .discriminatedUnion('type', [
    ImportProgressEvent,
    ImportCompletedEvent,
    RatesBackfilledEvent,
    InvoicePdfReadyEvent,
  ])
  .meta({ id: 'OrgEvent' });
export type OrgEvent = z.output<typeof OrgEvent>;
export type OrgEventType = OrgEvent['type'];
export type OrgEventOf<T extends OrgEventType> = Extract<OrgEvent, { type: T }>;

/** Postgres NOTIFY channel the worker publishes on; payload `{ orgId | null, event }`. */
export const EVENTS_NOTIFY_CHANNEL = 'org_events';
export const NotifyPayload = z.object({
  /** null = broadcast to every org (rates). */
  orgId: Uuid.nullable(),
  event: OrgEvent,
});
export type NotifyPayload = z.output<typeof NotifyPayload>;
