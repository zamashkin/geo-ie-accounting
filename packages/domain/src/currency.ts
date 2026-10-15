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
