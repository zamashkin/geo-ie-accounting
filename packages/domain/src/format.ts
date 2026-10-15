import { minorUnitExponent } from './currency';
import { parsePeriod } from './date';
import type { Period } from './date';
import { formatDecimal } from './money';
import type { Money } from './money';

// Display formatting (ARCHITECTURE §9: money display goes through here, never ad hoc).
// Amounts reach Intl.NumberFormat as exact decimal strings, never as JS numbers, so values
// beyond 2^53 tetri still print exactly.

export const LOCALES = ['en', 'ka', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

type DecimalString = `${number}`;

export interface MoneyFormatOptions {
  /**
   * `narrowSymbol` (default): ₾ / $ / € in every locale (`symbol` prints "GEL" in `en`);
   * `code`: GEL / USD.
   */
  readonly currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name';
  /** `exceptZero` shows "+" on income. */
  readonly signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never' | 'negative';
}

const formatters = new Map<string, Intl.NumberFormat>();

function cached(key: string, create: () => Intl.NumberFormat): Intl.NumberFormat {
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = create();
    formatters.set(key, formatter);
  }
  return formatter;
}

const decimalOf = (m: Money): DecimalString =>
  formatDecimal(m.amountMinor, minorUnitExponent(m.currency)) as DecimalString;

/** `formatMoney({ amountMinor: 123456n, currency: 'GEL' }, 'en')` → `"₾1,234.56"`. */
export function formatMoney(
  m: Money,
  locale: Locale = 'en',
  options: MoneyFormatOptions = {},
): string {
  const digits = minorUnitExponent(m.currency);
  const currencyDisplay = options.currencyDisplay ?? 'narrowSymbol';
  const signDisplay = options.signDisplay ?? 'auto';
  const key = `money|${locale}|${m.currency}|${currencyDisplay}|${signDisplay}`;
  const formatter = cached(
    key,
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: m.currency,
        currencyDisplay,
        signDisplay,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }),
  );
  return formatter.format(decimalOf(m));
}

/** Amount with grouping and the currency's decimals, no currency sign: `"1,234.56"`. */
export function formatAmount(m: Money, locale: Locale = 'en'): string {
  const digits = minorUnitExponent(m.currency);
  const formatter = cached(
    `amount|${locale}|${digits}`,
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }),
  );
  return formatter.format(decimalOf(m));
}

/** Basis points as a percentage: 100 → `"1%"`, 250 → `"2.5%"`. */
export function formatRateBp(bp: number, locale: Locale = 'en'): string {
  const formatter = cached(
    `percent|${locale}`,
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }),
  );
  return formatter.format(formatDecimal(BigInt(bp), 4) as DecimalString);
}

/** `"2026-09"` → `"September 2026"` (en), localised month name. */
export function formatPeriodLabel(period: Period, locale: Locale = 'en'): string {
  const { year, month } = parsePeriod(period);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}
