import type { CurrencyCode } from './currency';
import { addDays, assertIsoDate, type IsoDate } from './date';
import { InvalidInvoiceError } from './errors';
import { money, parseDecimal } from './money';
import { round, type RoundingMode } from './rounding';

// Invoices (WS-09): line totals, the invoice total, what is still owed, overdue, and the
// invoice number. Invoices never touch the ledger or the tax figures: income is still what the
// bank receipts post. No VAT: SBS entrepreneurs are generally not VAT payers and VAT is out of
// scope for v1 (SPEC §M4, "Out of scope").

/** Quantities carry up to 3 decimal places (`"1.5"` hours, `"0.125"` days). */
export const QUANTITY_DECIMALS = 3;
const QUANTITY_SCALE = 10n ** BigInt(QUANTITY_DECIMALS);

/**
 * Line totals round half away from zero, as invoices and receipts usually do. This is not the
 * FX or tax rounding of ADR 0007: an invoice total is a commercial amount, never a tax figure.
 */
export const INVOICE_ROUNDING_MODE: RoundingMode = 'half_up';

export interface InvoiceLineInput {
  /** Decimal string, at most {@link QUANTITY_DECIMALS} places, > 0. */
  readonly quantity: string;
  /** Minor units of the invoice currency, ≥ 0. */
  readonly unitPriceMinor: bigint;
}

export interface InvoiceTotals {
  /** One per input line, same order. */
  readonly lineTotalsMinor: readonly bigint[];
  readonly totalMinor: bigint;
}

/** `"1.5"` → 1500n (thousandths). Throws on more than 3 decimals, zero or a negative value. */
export function parseQuantity(quantity: string): bigint {
  let scaled: bigint;
  try {
    scaled = parseDecimal(quantity, QUANTITY_DECIMALS);
  } catch {
    throw new InvalidInvoiceError(
      `Quantity '${quantity}' must be a decimal with at most ${QUANTITY_DECIMALS} places`,
    );
  }
  if (scaled <= 0n) throw new InvalidInvoiceError('Quantity must be greater than zero');
  return scaled;
}

/** quantity × unit price, rounded once to the currency's minor unit. */
export function invoiceLineTotal(line: InvoiceLineInput): bigint {
  if (line.unitPriceMinor < 0n) throw new InvalidInvoiceError('Unit price cannot be negative');
  const quantity = parseQuantity(line.quantity);
  return round(quantity * line.unitPriceMinor, QUANTITY_SCALE, INVOICE_ROUNDING_MODE);
}

/**
 * Totals of an invoice: each line rounded on its own, then summed, so the printed lines always
 * add up to the printed total. Throws when the total leaves the int64 range.
 */
export function computeInvoiceTotals(
  currency: CurrencyCode,
  lines: readonly InvoiceLineInput[],
): InvoiceTotals {
  const lineTotalsMinor = lines.map(invoiceLineTotal);
  const total = lineTotalsMinor.reduce((a, b) => a + b, 0n);
  return { lineTotalsMinor, totalMinor: money(total, currency).amountMinor };
}

/** What is still owed: total − paid, never below zero (an overpayment leaves nothing owed). */
export function invoiceOutstanding(totalMinor: bigint, paidMinor: bigint): bigint {
  const rest = totalMinor - paidMinor;
  return rest > 0n ? rest : 0n;
}

/** Paid once the payments cover the total. A zero invoice cannot be issued, so never trivially. */
export function isFullyPaid(totalMinor: bigint, paidMinor: bigint): boolean {
  return totalMinor > 0n && paidMinor >= totalMinor;
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';

/** An issued invoice whose due date has passed (due today is not overdue yet). */
export function isInvoiceOverdue(
  invoice: { readonly status: InvoiceStatus; readonly dueDate: IsoDate | null },
  today: IsoDate,
): boolean {
  return invoice.status === 'issued' && invoice.dueDate !== null && invoice.dueDate < today;
}

/** Default days between issue and due date when the org sets none. */
export const DEFAULT_INVOICE_DUE_DAYS = 14;

export interface IssueDates {
  readonly issueDate: IsoDate;
  readonly dueDate: IsoDate;
}

/**
 * Dates an invoice is issued with: the draft's own, else today and today + `dueDays`. The due
 * date may not be before the issue date.
 */
export function resolveIssueDates(
  draft: { readonly issueDate: IsoDate | null; readonly dueDate: IsoDate | null },
  today: IsoDate,
  dueDays: number = DEFAULT_INVOICE_DUE_DAYS,
): IssueDates {
  const issueDate = draft.issueDate ?? today;
  assertIsoDate(issueDate);
  const dueDate = draft.dueDate ?? addDays(issueDate, dueDays);
  assertIsoDate(dueDate);
  if (dueDate < issueDate) {
    throw new InvalidInvoiceError('The due date cannot be before the issue date');
  }
  return { issueDate, dueDate };
}

/**
 * Checks what issuing needs beyond the dates: at least one line and a total above zero.
 * Returns the totals so the caller stores exactly what was checked.
 */
export function assertIssuable(
  currency: CurrencyCode,
  lines: readonly InvoiceLineInput[],
): InvoiceTotals {
  if (lines.length === 0) throw new InvalidInvoiceError('Add at least one line before issuing');
  const totals = computeInvoiceTotals(currency, lines);
  if (totals.totalMinor <= 0n) {
    throw new InvalidInvoiceError('An invoice needs a total above zero to be issued');
  }
  return totals;
}

/** Allowed in an invoice number prefix: letters, digits and `-`, `/`, `.`, `_`. */
export const INVOICE_PREFIX_PATTERN = /^[A-Za-z0-9./_-]{0,16}$/;

/**
 * `formatInvoiceNumber('INV-', 2026, 7)` → `"INV-2026-007"`. Numbering is gapless per org and
 * year; the sequence is padded to three digits and simply grows past 999.
 */
export function formatInvoiceNumber(prefix: string | null, year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new InvalidInvoiceError(`Invalid invoice year ${year}`);
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new InvalidInvoiceError(`Invalid invoice sequence ${seq}`);
  }
  const p = prefix ?? '';
  if (!INVOICE_PREFIX_PATTERN.test(p)) {
    throw new InvalidInvoiceError(`Invalid invoice number prefix '${p}'`);
  }
  return `${p}${year}-${String(seq).padStart(3, '0')}`;
}
