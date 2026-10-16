// Money formatting and parsing for display components.
//
// TODO(WS-01): switch to the formatting helpers in `packages/domain` (`domain/format.ts` and
// the minor-unit table in `domain/currency.ts`) once WS-01 lands, and delete this file's
// local table. ui -> domain is an allowed dependency (ARCHITECTURE §2).
//
// Everything here works on bigint minor units and decimal strings. No JS numbers touch an
// amount: Intl.NumberFormat formats an exact decimal string (ECMA-402 "Intl.NumberFormat v3").

/** Minor-unit exponents (ISO 4217). Anything not listed uses 2. */
const MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = {
  GEL: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  TRY: 2,
  RUB: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
};

export const DEFAULT_LOCALE = 'en-GB';

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENTS[currency] ?? 2;
}

/** Accepts the wire form (`"125000"`) or a bigint. Throws on anything that is not an integer. */
export function toMinor(amount: bigint | string): bigint {
  if (typeof amount === 'bigint') return amount;
  if (!/^-?[0-9]+$/.test(amount))
    throw new TypeError(`Not an integer minor-unit amount: ${amount}`);
  return BigInt(amount);
}

/** `125000n`, 2 → `"1250.00"`. Exact; the sign is kept. */
export function minorToDecimalString(amountMinor: bigint, exponent: number): string {
  const negative = amountMinor < 0n;
  const digits = (negative ? -amountMinor : amountMinor).toString().padStart(exponent + 1, '0');
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const fraction = exponent === 0 ? '' : `.${digits.slice(-exponent)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

type DecimalString = `${number}`;

export interface FormatMoneyOptions {
  locale?: string;
  /** `code`: "GEL 1,250.00"; `symbol`: "₾1,250.00"; `none`: "1,250.00". Default `code`. */
  currencyDisplay?: 'code' | 'symbol' | 'none';
  /** `auto` shows "-" for negatives only; `always` adds "+" to positives (for deltas). */
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never';
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(
  currency: string,
  exponent: number,
  opts: FormatMoneyOptions,
): Intl.NumberFormat {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const display = opts.currencyDisplay ?? 'code';
  const sign = opts.signDisplay ?? 'auto';
  const key = `${locale}|${currency}|${exponent}|${display}|${sign}`;
  let nf = formatterCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, {
      ...(display === 'none'
        ? { style: 'decimal' }
        : {
            style: 'currency',
            currency,
            currencyDisplay: display === 'symbol' ? 'narrowSymbol' : 'code',
          }),
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
      signDisplay: sign,
    });
    formatterCache.set(key, nf);
  }
  return nf;
}

/** Formats minor units for display, e.g. `formatMoney(125000n, 'GEL')` → `"GEL 1,250.00"`. */
export function formatMoney(
  amountMinor: bigint | string,
  currency: string,
  opts: FormatMoneyOptions = {},
): string {
  return formatMoneyToParts(amountMinor, currency, opts)
    .map((p) => p.value)
    .join('');
}

/** As `formatMoney`, but as Intl parts so components can style the currency separately. */
export function formatMoneyToParts(
  amountMinor: bigint | string,
  currency: string,
  opts: FormatMoneyOptions = {},
): Intl.NumberFormatPart[] {
  const exponent = minorUnitExponent(currency);
  const decimal = minorToDecimalString(toMinor(amountMinor), exponent) as DecimalString;
  return formatter(currency, exponent, opts).formatToParts(decimal);
}

export type ParseMoneyResult =
  | { ok: true; amountMinor: bigint }
  | { ok: false; reason: 'empty' | 'invalid' | 'too_many_decimals' | 'negative' };

export interface ParseMoneyOptions {
  allowNegative?: boolean;
}

/**
 * Parses what a person types into a money field into minor units, without floats.
 * Accepts "1250", "1,250.5", "1 250.50", "-12.3", "12." and ".5". Commas and spaces are
 * treated as group separators and the dot as the decimal separator (the app's EN locale).
 */
export function parseMoneyInput(
  text: string,
  currency: string,
  opts: ParseMoneyOptions = {},
): ParseMoneyResult {
  const exponent = minorUnitExponent(currency);
  const cleaned = text.trim().replace(/[\s\u00a0\u202f,']/g, '');
  if (cleaned === '' || cleaned === '-') return { ok: false, reason: 'empty' };
  const match = /^(-)?([0-9]*)(?:\.([0-9]*))?$/.exec(cleaned);
  if (!match) return { ok: false, reason: 'invalid' };
  const [, minus, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return { ok: false, reason: 'invalid' };
  if (minus && !opts.allowNegative) return { ok: false, reason: 'negative' };
  if (fraction.length > exponent) return { ok: false, reason: 'too_many_decimals' };
  const minorDigits = `${whole || '0'}${fraction.padEnd(exponent, '0')}`;
  const magnitude = BigInt(minorDigits);
  return { ok: true, amountMinor: minus ? -magnitude : magnitude };
}

/** Plain editable text for a minor amount: `125050n` → `"1250.50"` (no grouping). */
export function minorToInputText(amountMinor: bigint, currency: string): string {
  return minorToDecimalString(amountMinor, minorUnitExponent(currency));
}
