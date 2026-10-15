import { z } from 'zod';
import { CurrencyCode, IsoDate, Period, Uuid } from './primitives';

// pg-boss job names and payloads (ARCHITECTURE §8). Payloads are JSON: no bigint here.
// Every payload may carry `meta` for request/trace correlation (WS-10 adds trace context).

export const JobMeta = z.object({
  requestId: z.string().optional(),
  /** W3C traceparent header value. */
  traceparent: z.string().optional(),
});
export type JobMeta = z.output<typeof JobMeta>;

const withMeta = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, meta: JobMeta.optional() });

export const jobPayloads = {
  /** Smoke-test job registered by the worker skeleton. */
  noop: withMeta({ message: z.string().max(200).optional() }),
  'rates.sync': withMeta({ currencies: z.array(CurrencyCode).min(1).optional() }),
  'rates.backfill': withMeta({
    from: IsoDate,
    to: IsoDate,
    currencies: z.array(CurrencyCode).min(1),
  }),
  'import.parse': withMeta({ orgId: Uuid, batchId: Uuid }),
  'import.commit': withMeta({ orgId: Uuid, batchId: Uuid }),
  'declaration.recompute': withMeta({ orgId: Uuid, periods: z.array(Period).min(1) }),
  'invoice.render_pdf': withMeta({ orgId: Uuid, invoiceId: Uuid }),
} as const;

export type JobName = keyof typeof jobPayloads;
export const JOB_NAMES = Object.keys(jobPayloads) as JobName[];
export const JobNameSchema = z.enum(JOB_NAMES as [JobName, ...JobName[]]);
export type JobPayload<N extends JobName> = z.output<(typeof jobPayloads)[N]>;

/** Validates a payload for the given job. Throws a ZodError when invalid. */
export function parseJobPayload<N extends JobName>(name: N, data: unknown): JobPayload<N> {
  return jobPayloads[name].parse(data) as JobPayload<N>;
}
