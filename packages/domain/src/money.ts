import { assertSupportedCurrency, minorUnitExponent } from './currency';
import type { CurrencyCode } from './currency';
import { AmountOutOfRangeError, CurrencyMismatchError, InvalidAmountError } from './errors';

/**
 * An amount in integer minor units of one currency (tetri, cents). Structurally the same as the
 * `Money` output type in packages/contracts, so wire values can be passed in directly.
 */
export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

/** Postgres `bigint` range. Amounts outside it cannot be stored, so they are rejected early. */
export const INT64_MIN = -(2n ** 63n);
export const INT64_MAX = 2n ** 63n - 1n;

function checkRange(amountMinor: bigint): bigint {
  if (amountMinor < INT64_MIN || amountMinor > INT64_MAX) {
    throw new AmountOutOfRangeError(amountMinor);
  }
  return amountMinor;
}

/** Creates money in a supported currency. Throws on unknown currencies and int64 overflow. */
export function money(amountMinor: bigint, currency: CurrencyCode): Money {
  assertSupportedCurrency(currency);
  return { amountMinor: checkRange(amountMinor), currency };
}

export function zero(currency: CurrencyCode): Money {
  return money(0n, currency);
}

/** Throws {@link CurrencyMismatchError} unless both have the same currency. */
export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.amountMinor, a.currency);
}

export function abs(a: Money): Money {
  return a.amountMinor < 0n ? negate(a) : a;
}

/** -1, 0 or 1. Throws on currency mismatch: amounts in different currencies are not ordered. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor === b.amountMinor) return 0;
  return a.amountMinor < b.amountMinor ? -1 : 1;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function isZero(a: Money): boolean {
  return a.amountMinor === 0n;
}

export function isNegative(a: Money): boolean {
  return a.amountMinor < 0n;
}

export function isPositive(a: Money): boolean {
  return a.amountMinor > 0n;
}

/**
 * Sums amounts that must all be in `currency`. The currency is explicit so an empty list still
 * has one. The range is checked on the total only, so intermediate overflow cannot happen.
 */
export function sum(currency: CurrencyCode, items: Iterable<Money>): Money {
  assertSupportedCurrency(currency);
  let total = 0n;
  for (const item of items) {
    if (item.currency !== currency) throw new CurrencyMismatchError(currency, item.currency);
    total += item.amountMinor;
  }
  return money(total, currency);
}

// ── Decimal strings ↔ minor units ──────────────────────────────────────────────────────────

const DECIMAL = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;

/**
 * Parses a plain decimal string ("1234.5", "-0.07", "12") into an integer scaled by
 * 10^`exponent`. Extra fractional digits are accepted only when they are zeros, so the result is
 * always exact. No thousands separators, no exponent notation, no plus sign.
 */
export function parseDecimal(input: string, exponent: number): bigint {
  const match = DECIMAL.exec(input);
  if (!match) throw new InvalidAmountError(`Not a decimal number: '${input}'`);
  const [, sign = '', whole = '', fraction = ''] = match;
  const significant = fraction.slice(0, exponent);
  if (/[^0]/.test(fraction.slice(exponent))) {
    throw new InvalidAmountError(`'${input}' has more than ${exponent} decimal places`);
  }
  const scaled = BigInt(whole + significant.padEnd(exponent, '0'));
  return sign === '-' ? -scaled : scaled;
}

/** Inverse of {@link parseDecimal}: `formatDecimal(-1234n, 2)` → `"-12.34"`. */
export function formatDecimal(value: bigint, exponent: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** `parseMoney("1000.50", "USD")` → 100050 cents. Uses the currency's minor-unit exponent. */
export function parseMoney(input: string, currency: CurrencyCode): Money {
  return money(parseDecimal(input, minorUnitExponent(currency)), currency);
}

/** Canonical decimal string in major units: 100050 USD cents → `"1000.50"`. For display use format.ts. */
export function toDecimalString(m: Money): string {
  return formatDecimal(m.amountMinor, minorUnitExponent(m.currency));
}
