import { CurrencyCode, RateDecimal, type IsoDate } from '@ie-ledger/contracts';
import { z } from 'zod';
import { NBG_UTC_OFFSET } from './dates';
import { NbgResponseError } from './errors';

// Shape of the NBG body (SPEC §2.3, recorded in fixtures/nbg/). Only the fields we use are
// validated; `diff`, `diffFormated` and anything NBG adds later are ignored.

/** NBG timestamps: `2026-10-13T17:01:10.440Z`. */
const NbgTimestamp = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)Z$/, 'Expected an NBG timestamp');

const NbgCurrencyEntry = z.object({
  code: CurrencyCode,
  quantity: z.int().positive(),
  /** Four decimals, e.g. `"2.4760"`. The source of truth for the rate. */
  rateFormated: RateDecimal,
  name: z.string(),
  /** When the rate was set. Tbilisi wall-clock time despite the `Z` (see fixtures/nbg/README.md). */
  date: NbgTimestamp,
  /** First day the rate applies to, at midnight. */
  validFromDate: NbgTimestamp,
});

export const NbgResponseBody = z.array(
  z.object({
    date: NbgTimestamp,
    currencies: z.array(NbgCurrencyEntry),
  }),
);
export type NbgResponseBody = z.output<typeof NbgResponseBody>;

/** One published rate: GEL per `quantity` units of `currency`. */
export interface NbgRate {
  currency: CurrencyCode;
  /** First calendar day the rate applies to. */
  validFrom: IsoDate;
  /** Decimal string exactly as NBG formats it, e.g. `"2.5989"`. Never a float. */
  rate: RateDecimal;
  quantity: number;
  /** When NBG set the rate, as a UTC instant (`2026-10-13T13:01:10.440Z`). */
  setAt: string;
  name: string;
}

/**
 * NBG labels Tbilisi wall-clock time with `Z`. Reattach the real offset and convert to UTC:
 * `2026-10-13T17:01:10.440Z` becomes `2026-10-13T13:01:10.440Z`.
 */
export function nbgSetTimeToUtc(timestamp: string): string {
  const local = timestamp.slice(0, -1);
  const instant = new Date(`${local}${NBG_UTC_OFFSET}`);
  if (Number.isNaN(instant.getTime())) throw new NbgResponseError(`bad timestamp '${timestamp}'`);
  return instant.toISOString();
}

const isZero = (decimal: string) => /^0(\.0+)?$/.test(decimal);

/**
 * Validates an NBG body and returns one rate per currency. `requestedDate` is the `date` query
 * parameter; NBG returns the rate valid on that date, so `validFrom` can never be later.
 */
export function parseNbgResponse(body: unknown, requestedDate: IsoDate): NbgRate[] {
  const parsed = NbgResponseBody.safeParse(body);
  if (!parsed.success) {
    throw new NbgResponseError(z.prettifyError(parsed.error), parsed.error);
  }
  const rates: NbgRate[] = [];
  const seen = new Set<string>();
  for (const group of parsed.data) {
    for (const entry of group.currencies) {
      const validFrom = entry.validFromDate.slice(0, 10);
      if (validFrom > requestedDate) {
        throw new NbgResponseError(
          `${entry.code} is valid from ${validFrom}, after the requested ${requestedDate}`,
        );
      }
      if (isZero(entry.rateFormated)) {
        throw new NbgResponseError(`${entry.code} has a zero rate on ${validFrom}`);
      }
      if (seen.has(entry.code)) throw new NbgResponseError(`${entry.code} appears twice`);
      seen.add(entry.code);
      rates.push({
        currency: entry.code,
        validFrom,
        rate: entry.rateFormated,
        quantity: entry.quantity,
        setAt: nbgSetTimeToUtc(entry.date),
        name: entry.name,
      });
    }
  }
  return rates;
}
