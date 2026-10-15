import { z } from 'zod';
import { ParserId } from './enums';

// Additions from WS-03 (statement parsers). `ParseWarning.code` stays a free snake_case string so
// older stored warnings keep validating; this enum is the catalogue current parsers emit, for the
// UI to translate and for the import pipeline to branch on.

export const PARSE_WARNING_CODES = [
  /** The bytes are not a file the parser can read (not a zip, not text, no worksheet). */
  'unreadable_file',
  /** Bytes were not valid UTF-8 and were decoded as windows-1252. */
  'encoding_fallback',
  /** A quoted CSV field was never closed; the rest of the file was read as that field. */
  'unterminated_quote',
  /** No header row with the expected columns was found. */
  'header_not_found',
  /** A required (or mapped) column is missing. */
  'missing_column',
  /** `generic-csv` was called without a column mapping. */
  'mapping_required',
  /** A row could not be read (bad date or amount) and was skipped. */
  'unparseable_row',
  /** A row has both a debit and a credit; the amount is credit minus debit. */
  'ambiguous_debit_credit',
  /** BoG XLSX: the signed `Amount` disagrees with `Debit`/`Credit`; `Amount` was used. */
  'amount_mismatch',
  /** An amount had more decimals than its currency allows and was rounded half away from zero. */
  'amount_rounded',
  /** Unknown or missing bank operation code; the row's operationType is `other`. */
  'unknown_operation_type',
  /** The operation type and the direction of the money disagree. */
  'unexpected_direction',
  /** The statement currency differs from the account it is imported into. */
  'currency_mismatch',
  /** A currency code is missing or malformed; the account currency was used. */
  'invalid_currency',
  /** Opening balance + Σ amounts ≠ closing balance. */
  'reconciliation_mismatch',
  /** Opening or closing balance missing, so the statement could not be reconciled. */
  'reconciliation_unavailable',
  /** BoG XLSX: a row's running `Balance` stops matching opening + Σ amounts. */
  'running_balance_mismatch',
  /** BoG CSV: the total turnover row disagrees with the sum of the rows. */
  'turnover_mismatch',
  /** The file was read but contains no transactions. */
  'no_rows',
  /** A row is dated outside the statement period. */
  'date_outside_period',
  /** The parser hit an unexpected error and returned no rows. Always a bug. */
  'internal_error',
] as const;
export const ParseWarningCode = z.enum(PARSE_WARNING_CODES).meta({ id: 'ParseWarningCode' });
export type ParseWarningCode = z.output<typeof ParseWarningCode>;

/** Result of format detection (`detectBest` in packages/importers), e.g. for the import wizard. */
export const StatementDetection = z
  .object({
    parserId: ParserId,
    /** 0..1. Below 0.5 the UI should ask the user to confirm the format. */
    confidence: z.number().min(0).max(1),
  })
  .meta({ id: 'StatementDetection' });
export type StatementDetection = z.output<typeof StatementDetection>;
