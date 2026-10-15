import { z } from 'zod';
import { ExchangeRate } from './entities';
import { PaginationQuery, paginated } from './pagination';
import { CurrencyCode, IsoDate } from './primitives';

// Request/response shapes for /v1/rates (WS-02). The ExchangeRate DTO lives in entities.ts.

/** Longest range one backfill request may cover: five years of daily NBG requests. */
export const RATES_BACKFILL_MAX_DAYS = 1830;
/** Most currencies one backfill request may name. */
export const RATES_BACKFILL_MAX_CURRENCIES = 20;

const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/** GET /v1/rates?currency=&from=&to=&cursor=&limit= — newest `validFrom` first. */
export const ListRatesQuery = PaginationQuery.extend({
  currency: CurrencyCode.optional(),
  /** Inclusive lower bound on `validFrom`. */
  from: IsoDate.optional(),
  /** Inclusive upper bound on `validFrom`. */
  to: IsoDate.optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, {
  message: '`from` must not be after `to`',
  path: ['from'],
});
export type ListRatesQuery = z.output<typeof ListRatesQuery>;

export const ListRatesResponse = paginated(ExchangeRate).meta({ id: 'ListRatesResponse' });
export type ListRatesResponse = z.output<typeof ListRatesResponse>;

/** POST /v1/rates/backfill: the same fields as the `rates.backfill` job payload. */
export const BackfillRatesRequest = z
  .object({
    from: IsoDate,
    to: IsoDate,
    currencies: z.array(CurrencyCode).min(1).max(RATES_BACKFILL_MAX_CURRENCIES),
  })
  .refine((b) => b.from <= b.to, { message: '`from` must not be after `to`', path: ['from'] })
  .refine((b) => dayNumber(b.to) - dayNumber(b.from) < RATES_BACKFILL_MAX_DAYS, {
    message: `A backfill covers at most ${RATES_BACKFILL_MAX_DAYS} days`,
    path: ['to'],
  })
  .meta({ id: 'BackfillRatesRequest' });
export type BackfillRatesRequest = z.output<typeof BackfillRatesRequest>;

/** 202: the job is queued; `rates.backfilled` is emitted when it finishes. */
export const BackfillRatesResponse = z
  .object({
    jobId: z.string(),
    status: z.literal('queued'),
  })
  .meta({ id: 'BackfillRatesResponse' });
export type BackfillRatesResponse = z.output<typeof BackfillRatesResponse>;
