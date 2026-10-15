import { DomainError } from './errors';

// The one place integer division rounds. FX conversion and tax both call `round`, so switching
// the rounding policy (SPEC Q6, ADR 0007) is a change to DEFAULT_ROUNDING_MODE or to the mode a
// caller passes, never to the arithmetic.

/**
 * - `half_even`: ties to the even neighbour (banker's rounding). Default until Q6 is answered.
 * - `half_up`: ties away from zero (the usual "school" rounding, symmetric for negatives).
 * - `half_down`: ties toward zero.
 * - `up` / `down`: away from / toward zero.
 * - `ceiling` / `floor`: toward +∞ / −∞.
 */
export const ROUNDING_MODES = [
  'half_even',
  'half_up',
  'half_down',
  'up',
  'down',
  'ceiling',
  'floor',
] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/** Pending ADR 0007 / SPEC Q6. */
export const DEFAULT_ROUNDING_MODE: RoundingMode = 'half_even';

/**
 * `numerator / denominator` rounded to an integer with `mode`. Exact: bigint only, no floats.
 * Throws when `denominator` is zero.
 */
export function round(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE,
): bigint {
  if (denominator === 0n) throw new DomainError('division_by_zero', 'Division by zero');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const truncated = numerator / denominator; // bigint division truncates toward zero
  const remainder = numerator % denominator; // same sign as numerator
  if (remainder === 0n) return truncated;

  const negative = numerator < 0n;
  const awayFromZero = negative ? truncated - 1n : truncated + 1n;
  const twiceRemainder = 2n * (negative ? -remainder : remainder);

  switch (mode) {
    case 'down':
      return truncated;
    case 'up':
      return awayFromZero;
    case 'floor':
      return negative ? awayFromZero : truncated;
    case 'ceiling':
      return negative ? truncated : awayFromZero;
    case 'half_up':
      return twiceRemainder >= denominator ? awayFromZero : truncated;
    case 'half_down':
      return twiceRemainder > denominator ? awayFromZero : truncated;
    case 'half_even':
      if (twiceRemainder !== denominator) {
        return twiceRemainder > denominator ? awayFromZero : truncated;
      }
      return truncated % 2n === 0n ? truncated : awayFromZero;
  }
}

/**
 * Rounds `amountMinor` to a multiple of `stepMinor` (e.g. step 100 = whole lari). One of the
 * Q6 options for the tax figure on the return.
 */
export function roundToStep(
  amountMinor: bigint,
  stepMinor: bigint,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE,
): bigint {
  if (stepMinor <= 0n) throw new DomainError('invalid_amount', 'Rounding step must be positive');
  return round(amountMinor, stepMinor, mode) * stepMinor;
}
