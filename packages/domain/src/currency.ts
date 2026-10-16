import { UnsupportedCurrencyError } from './errors';

// Currencies the app can hold money in, with their ISO 4217 minor-unit exponent
// (number of decimal places). GEL, USD, EUR and GBP are the ones the product targets
// (ARCHITECTURE §3); the rest are NBG-published currencies a client might pay in.
// Adding a currency is one line here; nothing else hardcodes exponents.

export const CURRENCIES = {
  GEL: { exponent: 2 },
  USD: { exponent: 2 },
  EUR: { exponent: 2 },
  GBP: { exponent: 2 },
  CHF: { exponent: 2 },
  TRY: { exponent: 2 },
  AMD: { exponent: 2 },
  AZN: { exponent: 2 },
  UAH: { exponent: 2 },
  JPY: { exponent: 0 },
  KWD: { exponent: 3 },
} as const satisfies Record<string, { exponent: number }>;

export type SupportedCurrency = keyof typeof CURRENCIES;

/** ISO 4217 alphabetic code. Kept as `string` so wire values (contracts) fit without casts. */
export type CurrencyCode = string;

/** The ledger's base and reporting currency. */
export const BASE_CURRENCY = 'GEL' satisfies SupportedCurrency;

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES) as SupportedCurrency[];

export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return Object.hasOwn(CURRENCIES, code);
}

/** Throws {@link UnsupportedCurrencyError} for codes outside {@link CURRENCIES}. */
export function assertSupportedCurrency(code: string): asserts code is SupportedCurrency {
  if (!isSupportedCurrency(code)) throw new UnsupportedCurrencyError(code);
}

/** Number of decimal places of the currency's minor unit (GEL → 2: 1 lari = 100 tetri). */
export function minorUnitExponent(code: string): number {
  assertSupportedCurrency(code);
  return CURRENCIES[code].exponent;
}

// Statements and the UI also meet currencies the ledger does not hold (a conversion's counter
// currency, an amount typed before the currency is checked). Their amounts still need the right
// number of decimals, so the ISO 4217 exceptions to "2 decimals" are listed here once.
const ISO_4217_EXPONENT_EXCEPTIONS: ReadonlyMap<string, number> = new Map([
  // Zero-decimal currencies.
  ['JPY', 0],
  ['KRW', 0],
  ['ISK', 0],
  ['CLP', 0],
  ['VND', 0],
  // Three-decimal currencies.
  ['BHD', 3],
  ['IQD', 3],
  ['JOD', 3],
  ['KWD', 3],
  ['LYD', 3],
  ['OMR', 3],
  ['TND', 3],
]);

const ISO_CODE = /^[A-Z]{3}$/;

/** True for a well-formed ISO 4217 alphabetic code (three capital letters), supported or not. */
export function isCurrencyCode(code: string): boolean {
  return ISO_CODE.test(code);
}

/**
 * Minor-unit exponent of any ISO 4217 code, never throwing: {@link CURRENCIES} first, then the
 * known 0- and 3-decimal currencies, else 2. For parsing and display only; ledger money uses
 * {@link minorUnitExponent}, which rejects unsupported currencies.
 */
export function iso4217Exponent(code: string): number {
  if (isSupportedCurrency(code)) return CURRENCIES[code].exponent;
  return ISO_4217_EXPONENT_EXCEPTIONS.get(code) ?? 2;
}
