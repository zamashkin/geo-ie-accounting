// Minor-unit exponents for the currencies a statement may carry.
//
// TODO(WS-01 consolidation): ARCHITECTURE §3 puts the ISO 4217 table in `domain/currency.ts`, which
// did not exist when WS-03 started. Switch to it once it lands; this copy stays private.

const EXPONENTS: Readonly<Record<string, number>> = {
  // Zero-decimal currencies.
  JPY: 0,
  KRW: 0,
  ISK: 0,
  CLP: 0,
  VND: 0,
  // Three-decimal currencies.
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

const ISO_CODE = /^[A-Z]{3}$/;

export function isCurrencyCode(code: string): boolean {
  return ISO_CODE.test(code);
}

/** Decimal places of a currency's minor unit. Everything not listed above has 2. */
export function currencyExponent(code: string): number {
  return EXPONENTS[code] ?? 2;
}
