import type { ParseWarning } from '@ie-ledger/contracts';

/**
 * Every warning code a parser can emit. Messages never include statement contents (names,
 * IBANs, amounts): warnings may end up in logs. They point at a statement row or a file line.
 */
export const WARNING_CODES = {
  /** The bytes are not a file this parser can read (not a zip, not text, no worksheet). */
  unreadable_file: 'unreadable_file',
  /** Bytes were not valid UTF-8 and were decoded as windows-1252. */
  encoding_fallback: 'encoding_fallback',
  /** A quoted CSV field was never closed; the rest of the file was read as that field. */
  unterminated_quote: 'unterminated_quote',
  /** No header row with the expected columns was found. */
  header_not_found: 'header_not_found',
  /** A required column is missing; the parser returns no rows. */
  missing_column: 'missing_column',
  /** `generic-csv` was called without a column mapping. */
  mapping_required: 'mapping_required',
  /** A row could not be read (bad date or amount) and was skipped. */
  unparseable_row: 'unparseable_row',
  /** A row has a value in both debit and credit; the amount is credit minus debit. */
  ambiguous_debit_credit: 'ambiguous_debit_credit',
  /** BoG XLSX: the signed `Amount` disagrees with `Debit`/`Credit`; `Amount` was used. */
  amount_mismatch: 'amount_mismatch',
  /** An amount had more decimals than its currency allows and was rounded half away from zero. */
  amount_rounded: 'amount_rounded',
  /** Bank operation code not in the known list; the row's operationType is `other`. */
  unknown_operation_type: 'unknown_operation_type',
  /** The operation code and the money direction disagree (e.g. an incoming payment that debits). */
  unexpected_direction: 'unexpected_direction',
  /** The statement's currency differs from the account it is imported into. */
  currency_mismatch: 'currency_mismatch',
  /** A currency code is missing or not ISO 4217-shaped; the account currency was used. */
  invalid_currency: 'invalid_currency',
  /** Opening balance + Σ amounts ≠ closing balance. */
  reconciliation_mismatch: 'reconciliation_mismatch',
  /** Opening or closing balance missing, so the statement could not be reconciled. */
  reconciliation_unavailable: 'reconciliation_unavailable',
  /** BoG XLSX: a row's running `Balance` differs from opening + Σ amounts so far. */
  running_balance_mismatch: 'running_balance_mismatch',
  /** BoG CSV: the `sul brunva` (total turnover) row disagrees with the sum of the rows. */
  turnover_mismatch: 'turnover_mismatch',
  /** The file was read but contains no transactions. */
  no_rows: 'no_rows',
  /** A row is dated outside the statement period. */
  date_outside_period: 'date_outside_period',
  /** An exception was caught by the safety net; no rows are returned. Always a bug. */
  internal_error: 'internal_error',
} as const;

export type WarningCode = keyof typeof WARNING_CODES;

/** Collects warnings for one parse. */
export class Warnings {
  readonly list: ParseWarning[] = [];

  add(code: WarningCode, message: string, rowIndex: number | null = null): void {
    this.list.push({ code, message, rowIndex });
  }
}
