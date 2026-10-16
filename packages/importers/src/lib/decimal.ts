// Statement amount text -> bigint minor units, without ever going through a JS number.
//
// Only the statement-specific tolerance lives here: thousands separators, parentheses, trailing
// minus signs, Excel exponent notation. packages/domain's `parseDecimal` is deliberately strict
// (canonical "1234.50" only, exact), so it cannot read bank exports; the step from digits to
// minor units rounds with domain `round` and exponents come from domain `iso4217Exponent`.
import { round } from '@ie-ledger/domain';

/** A decimal split into sign and digit strings, e.g. "-1,180.5" -> { negative, "1180", "5" }. */
export interface DecimalParts {
  negative: boolean;
  intDigits: string;
  fracDigits: string;
}

export type DecimalSeparator = '.' | ',';

// `\s` includes the no-break spaces used as thousands separators.
const SPACES = /\s/g;
const MINUS_SIGN = '−';

// Grouped integer part: 1-3 digits, then groups of exactly 3 separated by one consistent char.
const GROUPED_DOT = /^(\d{1,3})(?:([,' ])\d{3})?(?:\2\d{3})*$/;
const GROUPED_COMMA = /^(\d{1,3})(?:([.' ])\d{3})?(?:\2\d{3})*$/;

/**
 * Parses a human-written amount: optional `+`/`-`/U+2212 sign, accounting parentheses `(1.00)`,
 * a trailing minus `1.00-`, thousands separators (`,` `'` space for `.` decimals; `.` `'` space for
 * `,` decimals) and a trailing decimal separator (`900.` as BoG writes it). Returns null if the
 * text is not a single number.
 */
export function parseAmountText(
  input: string,
  decimalSeparator: DecimalSeparator = '.',
): DecimalParts | null {
  let s = input.trim();
  if (s === '') return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-') || s.startsWith(MINUS_SIGN)) {
    negative = !negative;
    s = s.slice(1).trimStart();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trimStart();
  } else if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1).trimEnd();
  }
  // Spaces used as thousands separators come in several flavours; fold them to a plain space.
  s = s.replace(SPACES, ' ');

  const sepIndex = s.lastIndexOf(decimalSeparator);
  let intPart = sepIndex === -1 ? s : s.slice(0, sepIndex);
  const fracPart = sepIndex === -1 ? '' : s.slice(sepIndex + 1);
  if (!/^\d*$/.test(fracPart)) return null;
  if (intPart === '') {
    if (fracPart === '') return null;
    intPart = '0';
  }
  if (!/^\d+$/.test(intPart)) {
    const grouped = (decimalSeparator === '.' ? GROUPED_DOT : GROUPED_COMMA).exec(intPart);
    if (!grouped) return null;
    intPart = intPart.replace(/\D/g, '');
  }
  if (significantIntDigits(intPart) > MAX_AMOUNT_INT_DIGITS) return null;
  return { negative, intDigits: intPart, fracDigits: fracPart };
}

/**
 * Amounts with more integer digits than this are rejected: 10^15 is far beyond any statement, and
 * the cap keeps every accepted amount inside the int64 range of `MinorUnits` (up to 3 decimals).
 */
export const MAX_AMOUNT_INT_DIGITS = 15;

function significantIntDigits(digits: string): number {
  return digits.replace(/^0+/, '').length;
}

/**
 * Parses the plain number format of an XLSX `<v>` element or a machine-written CSV:
 * `-690.85`, `1180.0`, `9.0000000001E10`. No separators, `.` decimal. Numbers with more than
 * `maxIntDigits` integer digits are rejected (pass Infinity for identifiers).
 */
export function parsePlainNumber(
  input: string,
  maxIntDigits = MAX_AMOUNT_INT_DIGITS,
): DecimalParts | null {
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,3}))?$/.exec(input.trim());
  if (!m) return null;
  let intDigits = m[2] ?? '';
  let fracDigits = m[3] ?? '';
  if (intDigits === '' && fracDigits === '') return null;
  const exp = m[4] === undefined ? 0 : Number.parseInt(m[4], 10);
  if (exp > 0) {
    const moved = fracDigits.slice(0, exp).padEnd(exp, '0');
    intDigits += moved;
    fracDigits = fracDigits.slice(exp);
  } else if (exp < 0) {
    const shift = -exp;
    const padded = intDigits.padStart(shift, '0');
    fracDigits = padded.slice(padded.length - shift) + fracDigits;
    intDigits = padded.slice(0, padded.length - shift);
  }
  if (significantIntDigits(intDigits) > maxIntDigits) return null;
  return { negative: m[1] === '-', intDigits: intDigits === '' ? '0' : intDigits, fracDigits };
}

export interface MinorResult {
  minor: bigint;
  /**
   * True when digits beyond the currency's exponent were non-zero and had to be rounded
   * (half away from zero). Spreadsheet float noise like `1806.7600000000002` lands here too.
   */
  rounded: boolean;
  /** True when the dropped digits look like binary float noise (runs of 0s or 9s). */
  floatNoise: boolean;
}

/**
 * Converts decimal parts to integer minor units for a currency with `exponent` decimals. Extra
 * digits round half away from zero (domain `round`, `half_up`).
 */
export function toMinor(parts: DecimalParts, exponent: number): MinorResult {
  const dropped = parts.fracDigits.slice(exponent);
  const digits = BigInt(
    parts.intDigits + parts.fracDigits.slice(0, exponent).padEnd(exponent, '0'),
  );
  const minor =
    dropped === ''
      ? digits
      : round(BigInt(parts.intDigits + parts.fracDigits), 10n ** BigInt(dropped.length), 'half_up');
  const rounded = /[1-9]/.test(dropped);
  const floatNoise = rounded && /^(?:0{6,}|9{6,})\d*$/.test(dropped);
  return { minor: parts.negative ? -minor : minor, rounded, floatNoise };
}

/** True if the parts are exactly zero. */
export function isZero(parts: DecimalParts): boolean {
  return !/[1-9]/.test(parts.intDigits + parts.fracDigits);
}
