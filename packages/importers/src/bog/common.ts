// Shared Bank of Georgia rules. Field semantics: fixtures/statements/bog/FORMAT.md.

import type { OperationType, ParsedRow, StatementMeta } from '@geo-ie-accounting/contracts';
import { isCurrencyCode, iso4217Exponent } from '@geo-ie-accounting/domain';
import { parseDate } from '../lib/dates';
import type { DecimalParts } from '../lib/decimal';
import { parseAmountText, toMinor } from '../lib/decimal';
import type { Warnings } from '../warnings';

/** BoG operation codes seen so far. Anything else maps to `other` with a warning. */
const OPERATION_CODES: Readonly<Record<string, OperationType>> = {
  PMI: 'incoming_payment',
  CCO: 'fx_conversion',
};

export function operationTypeOf(code: string): OperationType | null {
  return OPERATION_CODES[code] ?? null;
}

export interface AccountField {
  iban: string | null;
  currency: string | null;
}

/**
 * `GE59BG0000000123456789GBP (123456789)`: IBAN, currency suffix, internal account number.
 * BoG keeps one IBAN for all currency accounts of a client, so the suffix tells them apart.
 */
export function parseAccountField(value: string): AccountField {
  const token = value.trim().split(/[\s(]/, 1)[0] ?? '';
  const m = /^([A-Z]{2}\d{2}[A-Z0-9]*\d)([A-Z]{3})?$/.exec(token);
  if (!m) return { iban: null, currency: null };
  return { iban: m[1] ?? null, currency: m[2] ?? null };
}

/** `15.05.2025-15.06.2025` (XLSX) or `15.05.25-15.06.25` (CSV). */
export function parsePeriod(value: string): { from: string | null; to: string | null } {
  const [a = '', b = ''] = value
    .trim()
    .split('-')
    .map((s) => s.trim());
  const date = (s: string) => parseDate(s, 'DD.MM.YYYY') ?? parseDate(s, 'DD.MM.YY');
  return { from: date(a), to: date(b) };
}

/**
 * Converts parsed decimal parts to minor units of `currency`, warning when digits had to be
 * rounded away (float noise from a spreadsheet is rounded silently).
 */
export function minorOf(
  parts: DecimalParts,
  currency: string,
  warnings: Warnings,
  rowIndex: number | null,
): bigint {
  const { minor, rounded, floatNoise } = toMinor(parts, iso4217Exponent(currency));
  if (rounded && !floatNoise) {
    warnings.add(
      'amount_rounded',
      'An amount had more decimals than its currency allows and was rounded.',
      rowIndex,
    );
  }
  return minor;
}

/**
 * The conversion counter-amount written in descriptions: `Counter-amount: USD900..` or
 * `Counter-amount: GEL1,785.83.` (note the trailing dots and thousands separators).
 */
export function counterAmountFromText(
  text: string,
  warnings: Warnings,
  rowIndex: number,
): { amountMinor: bigint; currency: string } | null {
  const m = /Counter-amount:\s*([A-Z]{3})\s*(\d[\d,]*(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const currency = m[1] ?? '';
  const parts = parseAmountText(m[2] ?? '', '.');
  if (parts === null) return null;
  return {
    amountMinor: minorOf({ ...parts, negative: false }, currency, warnings, rowIndex),
    currency,
  };
}

/**
 * Incoming-transfer details in descriptions: `Incoming Transfer - Amount: GBP1,180.00; Sender:
 * <name>\<address>; Account: <acc>; Bank: <name> <BIC>; Details: <text>`.
 */
export function incomingTransferFields(
  text: string,
): Partial<Record<'Amount' | 'Sender' | 'Account' | 'Bank' | 'Details', string>> {
  const out: Partial<Record<'Amount' | 'Sender' | 'Account' | 'Bank' | 'Details', string>> = {};
  const keys = /(?:^|;\s*|\s-\s)(Amount|Sender|Account|Bank|Details):\s*/g;
  const hits = [...text.matchAll(keys)];
  hits.forEach((hit, i) => {
    const key = hit[1] as keyof typeof out;
    const start = hit.index + hit[0].length;
    const next = hits[i + 1];
    const end = next === undefined ? text.length : next.index;
    out[key] ??= text.slice(start, end).trim();
  });
  return out;
}

/** True if `account` is our own IBAN with another currency suffix (a conversion leg). */
export function isOwnOtherCurrencyAccount(account: string | null, meta: StatementMeta): boolean {
  if (account === null || meta.accountIban === null) return false;
  const other = parseAccountField(account);
  return (
    other.iban === meta.accountIban && other.currency !== null && other.currency !== meta.currency
  );
}

/** Resolves the statement currency: header value, else IBAN suffix, else the account's. */
export function statementCurrency(
  candidates: (string | null)[],
  accountCurrency: string,
  warnings: Warnings,
): string {
  const found = candidates.find((c): c is string => c !== null && isCurrencyCode(c));
  if (found === undefined) {
    warnings.add(
      'invalid_currency',
      'The statement does not state its currency; using the account currency.',
    );
    return accountCurrency;
  }
  if (found !== accountCurrency) {
    warnings.add(
      'currency_mismatch',
      'The statement currency differs from the currency of the selected account.',
    );
  }
  return found;
}

/** Opening + Σ amounts must equal closing (FORMAT.md). Adds a warning when it does not. */
export function reconcile(
  meta: StatementMeta,
  rows: readonly ParsedRow[],
  warnings: Warnings,
): void {
  if (meta.openingBalanceMinor === null || meta.closingBalanceMinor === null) {
    warnings.add(
      'reconciliation_unavailable',
      'The statement has no opening or closing balance, so it was not reconciled.',
    );
    return;
  }
  const total = rows.reduce((sum, r) => sum + r.amountMinor, meta.openingBalanceMinor);
  if (total !== meta.closingBalanceMinor) {
    warnings.add(
      'reconciliation_mismatch',
      `Opening balance plus the ${rows.length} imported rows does not equal the closing balance. Rows may be missing, skipped or duplicated.`,
    );
  }
}

/** Warns for rows dated outside the statement period. */
export function checkPeriod(
  meta: StatementMeta,
  rows: readonly ParsedRow[],
  warnings: Warnings,
): void {
  if (meta.periodFrom === null || meta.periodTo === null) return;
  for (const r of rows) {
    if (r.bookedOn < meta.periodFrom || r.bookedOn > meta.periodTo) {
      warnings.add(
        'date_outside_period',
        'The row is dated outside the statement period.',
        r.rowIndex,
      );
    }
  }
}

/** Common end-of-parse checks. */
export function finish(meta: StatementMeta, rows: readonly ParsedRow[], warnings: Warnings): void {
  if (rows.length === 0) warnings.add('no_rows', 'The statement contains no transactions.');
  checkPeriod(meta, rows, warnings);
  reconcile(meta, rows, warnings);
}

/** Warns when a code's expected direction disagrees with the sign of the amount. */
export function checkDirection(
  type: OperationType,
  amountMinor: bigint,
  warnings: Warnings,
  rowIndex: number,
): void {
  if (
    (type === 'incoming_payment' && amountMinor < 0n) ||
    (type === 'outgoing_payment' && amountMinor > 0n)
  ) {
    warnings.add(
      'unexpected_direction',
      'The operation type does not match the direction of the money.',
      rowIndex,
    );
  }
}
