import { z } from 'zod';

// Money crosses the wire as a decimal string of minor units ("125000" = 1,250.00) and is a
// bigint in code. MinorUnits is a Zod codec: `decode`/`parse` turns the string into a bigint,
// `encode` turns a bigint back into the string. Never a JS number.

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** Signed integer string: no leading zeros, no plus sign, no "-0", no decimals. */
export const MinorUnitsString = z
  .string()
  .regex(/^(0|-?[1-9][0-9]*)$/, 'Expected an integer amount in minor units, as a string')
  .meta({
    description: 'Integer amount in minor units (e.g. tetri, cents), as a decimal string.',
    examples: ['125000', '-69085'],
  });

export const MinorUnits = z.codec(MinorUnitsString, z.bigint().min(INT64_MIN).max(INT64_MAX), {
  decode: (s) => BigInt(s),
  encode: (n) => n.toString(),
});
export type MinorUnits = z.output<typeof MinorUnits>;

/**
 * ISO 4217 alphabetic code. Any code is accepted on the wire (statements and NBG carry many);
 * which currencies the app supports and their minor-unit exponents live in packages/domain.
 */
export const CurrencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 currency code')
  .meta({ examples: ['GEL', 'USD', 'EUR', 'GBP'] });
export type CurrencyCode = z.output<typeof CurrencyCode>;

export const Money = z.object({
  amountMinor: MinorUnits,
  currency: CurrencyCode,
});
export type Money = z.output<typeof Money>;
export type MoneyJson = z.input<typeof Money>;

/** Calendar date, `YYYY-MM-DD`. Kept as a string: dates here have no time zone. */
export const IsoDate = z.iso.date();
export type IsoDate = z.output<typeof IsoDate>;

/** Instant with offset, e.g. `2026-10-15T13:00:00.000Z`. */
export const Timestamp = z.iso.datetime({ offset: true });
export type Timestamp = z.output<typeof Timestamp>;

/** Reporting period `YYYY-MM`. */
export const Period = z
  .string()
  .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'Expected a period YYYY-MM')
  .meta({ examples: ['2026-09'] });
export type Period = z.output<typeof Period>;

export const Uuid = z.uuid();
export type Uuid = z.output<typeof Uuid>;

/**
 * Exchange rate as published by NBG: a decimal string with up to 6 decimal places, GEL per
 * `quantity` units of the foreign currency. Stored as numeric(18,6); scaled to bigint in domain.
 */
export const RateDecimal = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/, 'Expected a decimal rate with ≤ 6 decimals')
  .meta({ examples: ['2.7123', '3.6924'] });
export type RateDecimal = z.output<typeof RateDecimal>;

/** Positive decimal quantity as a string (invoice line quantities). */
export const QuantityDecimal = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$/, 'Expected a decimal with ≤ 3 decimals');
export type QuantityDecimal = z.output<typeof QuantityDecimal>;

/** IBAN without spaces. Georgian IBANs are 22 characters. */
export const Iban = z.string().regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/, 'Expected an IBAN');

export const JsonObject = z.record(z.string(), z.unknown());
export type JsonObject = z.output<typeof JsonObject>;
