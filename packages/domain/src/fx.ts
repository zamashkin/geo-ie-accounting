import { BASE_CURRENCY, minorUnitExponent } from './currency';
import type { CurrencyCode } from './currency';
import { CurrencyMismatchError, InvalidRateError, MissingRateError } from './errors';
import { formatDecimal, money, parseDecimal } from './money';
import type { Money } from './money';
import { round } from './rounding';
import type { RoundingMode } from './rounding';

// FX conversion to GEL at the NBG rate (ARCHITECTURE §3, SPEC §2.3). Rate lookup by date is
// packages/nbg's and the db's job; this module only does the arithmetic on a given rate.

/** Rates are stored as numeric(18,6) and scaled by 10^6 into a bigint in code. */
export const RATE_DECIMALS = 6;
export const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

/**
 * GEL per `quantity` units of the foreign currency, as NBG publishes it. `rateScaled` is
 * `rate * 10^6` ("2.7123" → 2712300n). `currency`, when given, is checked against the amount.
 */
export interface FxRate {
  readonly rateScaled: bigint;
  readonly quantity: number;
  readonly currency?: CurrencyCode;
}

/** Parses an NBG / DB rate string ("2.7123", "2.712300") into `rateScaled`. Must be positive. */
export function parseRate(decimal: string): bigint {
  let scaled: bigint;
  try {
    scaled = parseDecimal(decimal, RATE_DECIMALS);
  } catch {
    throw new InvalidRateError(`Not a rate with at most ${RATE_DECIMALS} decimals: '${decimal}'`);
  }
  if (scaled <= 0n) throw new InvalidRateError(`Rate must be positive: '${decimal}'`);
  return scaled;
}

/** Shortest decimal string for a scaled rate: 2712300n → `"2.7123"`, 3000000n → `"3"`. */
export function formatRate(rateScaled: bigint): string {
  return formatDecimal(rateScaled, RATE_DECIMALS).replace(/\.?0+$/, '');
}

function assertValidRate(rate: FxRate): void {
  if (rate.rateScaled <= 0n) throw new InvalidRateError('Rate must be positive');
  if (!Number.isSafeInteger(rate.quantity) || rate.quantity <= 0) {
    throw new InvalidRateError(`Rate quantity must be a positive integer, got ${rate.quantity}`);
  }
}

/**
 * GEL equivalent of `amount`:
 * `gelMinor = round(amountMinor * rateScaled / (quantity * 10^6))`, with the minor-unit exponents
 * of both currencies accounted for. GEL amounts are returned unchanged and need no rate.
 *
 * Rounds once, per amount (per posting). See ADR 0007 for the pending rounding policy.
 */
export function toGel(amount: Money, rate?: FxRate | null, mode?: RoundingMode): Money {
  if (amount.currency === BASE_CURRENCY) return money(amount.amountMinor, BASE_CURRENCY);
  if (!rate) throw new MissingRateError(amount.currency);
  if (rate.currency !== undefined && rate.currency !== amount.currency) {
    throw new CurrencyMismatchError(rate.currency, amount.currency);
  }
  assertValidRate(rate);
  const gelScale = 10n ** BigInt(minorUnitExponent(BASE_CURRENCY));
  const sourceScale = 10n ** BigInt(minorUnitExponent(amount.currency));
  const numerator = amount.amountMinor * rate.rateScaled * gelScale;
  const denominator = BigInt(rate.quantity) * RATE_SCALE * sourceScale;
  return money(round(numerator, denominator, mode), BASE_CURRENCY);
}

/**
 * How far the bank's own GEL equivalent of a statement line may be from ours before it is
 * flagged: one tetri, for rounding (fixtures/statements/bog/FORMAT.md).
 */
export const BANK_GEL_TOLERANCE_MINOR = 1n;

export interface BankGelDifference {
  /** Our GEL equivalent (NBG rate of the booked date). */
  readonly gelAmountMinor: bigint;
  /** The bank's GEL equivalent, signed like the line amount. */
  readonly bankGelAmountMinor: bigint;
  /** `bankGelAmountMinor - gelAmountMinor`. */
  readonly differenceMinor: bigint;
}

/**
 * Compares our GEL equivalent of a statement line with the one the bank printed. Returns the
 * difference when it is more than {@link BANK_GEL_TOLERANCE_MINOR}, otherwise null (also when the
 * statement has no GEL column). Informational only: our figure is always the one booked.
 */
export function compareBankGel(
  ours: Money,
  bankGelAmountMinor: bigint | null,
): BankGelDifference | null {
  if (ours.currency !== BASE_CURRENCY) {
    throw new CurrencyMismatchError(BASE_CURRENCY, ours.currency);
  }
  if (bankGelAmountMinor === null) return null;
  const differenceMinor = bankGelAmountMinor - ours.amountMinor;
  const magnitude = differenceMinor < 0n ? -differenceMinor : differenceMinor;
  if (magnitude <= BANK_GEL_TOLERANCE_MINOR) return null;
  return { gelAmountMinor: ours.amountMinor, bankGelAmountMinor, differenceMinor };
}
