import { z } from 'zod';
import { OperationType, ParserId } from './enums';
import { CurrencyCode, IsoDate, MinorUnits } from './primitives';

// Parser output (packages/importers) and parser options. Field notes come from
// fixtures/statements/bog/FORMAT.md.

/** A raw cell value as read from the file, kept for audit and re-parsing. */
export const RawCell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ParsedRow = z
  .object({
    /** 0-based index of the transaction within the statement (not the spreadsheet row). */
    rowIndex: z.int().nonnegative(),
    /** Booked date. */
    bookedOn: IsoDate,
    /** Signed amount in the account currency: negative = money out (debit on the statement). */
    amountMinor: MinorUnits,
    currency: CurrencyCode,
    /** Display name of the other party. SWIFT `\` wraps resolved per FORMAT.md. */
    counterparty: z.string().nullable(),
    /** The other party's account / IBAN. For BoG CCO it is our own IBAN with another currency. */
    counterpartyAccount: z.string().nullable(),
    description: z.string(),
    /** Stable bank reference for the dedupe hash (BoG XLSX: `Operation ID`, else `Ref`). */
    bankReference: z.string().nullable(),
    /** Statement document number (BoG `Doc N` / CSV `sabuTis #`); dedupe fallback for CSV. */
    documentNumber: z.string().nullable(),
    operationType: OperationType,
    /** Bank's own operation code as printed (`PMI`, `CCO`, ...). */
    bankOperationCode: z.string().nullable(),
    /**
     * Bank's GEL equivalent, signed like `amountMinor`. Informational only: the pipeline compares
     * it with domain `toGel()` and warns on a difference > 1 tetri. Never the source of truth.
     */
    bankGelAmountMinor: MinorUnits.nullable(),
    /** Counter-amount of a conversion (e.g. USD 900.00 for GBP → USD). Unsigned. */
    counterAmountMinor: MinorUnits.nullable(),
    counterCurrency: CurrencyCode.nullable(),
    /** Raw cells keyed by trimmed header. Contains personal data: never log it. */
    raw: z.record(z.string(), RawCell),
  })
  .meta({ id: 'ParsedRow' });
export type ParsedRow = z.output<typeof ParsedRow>;

export const ParseWarning = z
  .object({
    /** snake_case, e.g. `unknown_operation_type`, `reconciliation_mismatch`, `unparseable_row`. */
    code: z.string().regex(/^[a-z][a-z0-9_]*$/),
    message: z.string(),
    /** Statement row the warning refers to, when there is one. */
    rowIndex: z.int().nonnegative().nullable(),
  })
  .meta({ id: 'ParseWarning' });
export type ParseWarning = z.output<typeof ParseWarning>;

/** Header data from the statement, used for account matching and reconciliation. */
export const StatementMeta = z
  .object({
    accountIban: z.string().nullable(),
    currency: CurrencyCode.nullable(),
    periodFrom: IsoDate.nullable(),
    periodTo: IsoDate.nullable(),
    openingBalanceMinor: MinorUnits.nullable(),
    closingBalanceMinor: MinorUnits.nullable(),
  })
  .meta({ id: 'StatementMeta' });
export type StatementMeta = z.output<typeof StatementMeta>;

export const ParseResult = z
  .object({
    parserId: ParserId,
    meta: StatementMeta,
    rows: z.array(ParsedRow),
    warnings: z.array(ParseWarning),
  })
  .meta({ id: 'ParseResult' });
export type ParseResult = z.output<typeof ParseResult>;

/** Column mapping for the generic CSV parser, saved per account (`column_mappings`). */
export const GenericCsvMapping = z
  .object({
    delimiter: z.enum([',', ';', '\t']).optional(),
    /** 0-based header row index; rows before it are skipped. */
    headerRow: z.int().nonnegative().default(0),
    date: z.string(),
    dateFormat: z.enum(['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YY']),
    decimalSeparator: z.enum(['.', ',']),
    /** Either a signed amount column or a debit/credit pair. */
    amount: z.union([
      z.object({ kind: z.literal('signed'), column: z.string() }),
      z.object({ kind: z.literal('debit_credit'), debit: z.string(), credit: z.string() }),
    ]),
    /** Currency column; falls back to the account currency when absent. */
    currency: z.string().optional(),
    counterparty: z.string().optional(),
    description: z.string().optional(),
    reference: z.string().optional(),
  })
  .meta({ id: 'GenericCsvMapping' });
export type GenericCsvMapping = z.output<typeof GenericCsvMapping>;

export const ParseOptions = z.object({
  /** Currency of the account the statement is imported into. */
  accountCurrency: CurrencyCode,
  /** Required for `generic-csv`. */
  mapping: GenericCsvMapping.optional(),
});
export type ParseOptions = z.output<typeof ParseOptions>;
