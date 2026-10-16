import { z } from 'zod';
import { AnnualLimitStatus, DeclarationFigures, DeclarationYearFigures } from './domain';
import { Account, ImportBatch, ImportRow, Posting, Transaction } from './entities';
import {
  AccountKind,
  ImportRowStatus,
  IncomeClass,
  SystemAccountKey,
  TransactionSource,
} from './enums';
import { StatementDetection } from './parse-warnings';
import { PaginationQuery, paginated } from './pagination';
import { CurrencyCode, IsoDate, MinorUnits, Period, RateDecimal, Uuid } from './primitives';
import { OrgParams } from './tenancy';

// Requests and responses of the MVP ledger routes (docs/MVP.md, MVP-A): accounts, statement
// imports, transactions, declarations and the dashboard. All under /v1/orgs/:orgId.

// ── Accounts ────────────────────────────────────────────────────────────────────────────

/** `GET /accounts`: every active account of the org, oldest first. Not paginated (a chart is small). */
export const AccountList = z.object({ items: z.array(Account) }).meta({ id: 'AccountList' });
export type AccountList = z.output<typeof AccountList>;

// ── Imports ─────────────────────────────────────────────────────────────────────────────

/** Largest statement file `POST /imports` accepts. */
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export const ImportBatchParams = OrgParams.extend({ batchId: Uuid });
export type ImportBatchParams = z.output<typeof ImportBatchParams>;

export const ImportRowParams = ImportBatchParams.extend({ rowId: Uuid });
export type ImportRowParams = z.output<typeof ImportRowParams>;

/**
 * `POST /imports` body, sent as `multipart/form-data`. The file part is read by the API before
 * validation; on the server `file` holds its name, size and sha256 (used for the
 * Idempotency-Key request hash), never the bytes.
 */
export const UploadStatementRequest = z
  .object({
    file: z.any().meta({
      type: 'string',
      format: 'binary',
      description: 'Bank statement, XLSX or CSV, at most 5 MB. The file itself is not stored.',
    }),
    accountId: Uuid.optional().meta({
      description:
        'Book into this bank account. Default: match on the statement IBAN + currency, or create one.',
    }),
  })
  .meta({ id: 'UploadStatementRequest' });

/** How the bank account of an upload was found. */
export const ACCOUNT_MATCH_OUTCOMES = ['matched', 'claimed', 'created', 'chosen'] as const;
export const AccountMatchOutcome = z.enum(ACCOUNT_MATCH_OUTCOMES).meta({
  id: 'AccountMatchOutcome',
  description:
    '`matched`: IBAN + currency found. `claimed`: an unused default account of that currency ' +
    'got the IBAN. `created`: a new account. `chosen`: the `accountId` sent with the upload.',
});
export type AccountMatchOutcome = z.output<typeof AccountMatchOutcome>;

/** A batch with the bank account it books into. */
export const ImportBatchDetail = z
  .object({ batch: ImportBatch, account: Account })
  .meta({ id: 'ImportBatchDetail' });
export type ImportBatchDetail = z.output<typeof ImportBatchDetail>;

export const UploadStatementResponse = ImportBatchDetail.extend({
  accountMatch: AccountMatchOutcome,
  detection: StatementDetection,
}).meta({ id: 'UploadStatementResponse' });
export type UploadStatementResponse = z.output<typeof UploadStatementResponse>;

export const ImportBatchList = paginated(ImportBatch).meta({ id: 'ImportBatchList' });
export type ImportBatchList = z.output<typeof ImportBatchList>;

/**
 * A parsed statement line as the preview shows it. `raw` cells are left out.
 * - `status`: `new` (will be booked), `duplicate` (already in the ledger or earlier in the same
 *   file, never booked), `skipped` (by the user).
 * - `accountId`: what the row books against: `chosenAccountId`, else `suggestedAccountId`.
 *   A `new` row with a null `accountId` blocks the commit until the user picks one or skips it.
 * - `transactionId`: the transaction the row created, or for a duplicate the existing one.
 */
export const ImportRowView = ImportRow.omit({ raw: true })
  .extend({ accountId: Uuid.nullable() })
  .meta({ id: 'ImportRowView' });
export type ImportRowView = z.output<typeof ImportRowView>;

export const ListImportRowsQuery = PaginationQuery.extend({ status: ImportRowStatus.optional() });
export type ListImportRowsQuery = z.output<typeof ListImportRowsQuery>;

export const ImportRowList = paginated(ImportRowView).meta({ id: 'ImportRowList' });
export type ImportRowList = z.output<typeof ImportRowList>;

/**
 * `PATCH /imports/:batchId/rows/:rowId`. `accountId`: book against this account (null: back to
 * the suggestion). `skip`: true skips the row, false brings a skipped row back.
 */
export const UpdateImportRowRequest = z
  .object({ accountId: Uuid.nullable().optional(), skip: z.boolean().optional() })
  .refine((b) => b.accountId !== undefined || b.skip !== undefined, {
    message: 'Send accountId, skip or both',
  })
  .meta({ id: 'UpdateImportRowRequest' });
export type UpdateImportRowRequest = z.output<typeof UpdateImportRowRequest>;

/** `POST /imports/:batchId/commit`: every `new` row booked as one transaction each. */
/** Codes of the non-blocking warnings a commit can return. */
export const COMMIT_WARNING_CODES = ['bank_gel_mismatch'] as const;
export const CommitWarningCode = z.enum(COMMIT_WARNING_CODES).meta({
  id: 'CommitWarningCode',
  description:
    "`bank_gel_mismatch`: the bank's GEL equivalent of the line differs from ours (NBG rate of " +
    'the booked date) by more than 1 tetri. Ours is booked; check the rate the bank used.',
});
export type CommitWarningCode = z.output<typeof CommitWarningCode>;

/** Something worth checking about a booked row. The row is booked either way. */
export const CommitWarning = z
  .object({
    code: CommitWarningCode,
    rowId: Uuid,
    transactionId: Uuid,
    bookedOn: IsoDate,
    /** The line amount in the account currency. */
    amountMinor: MinorUnits,
    currency: CurrencyCode,
    /** Our GEL equivalent, as booked. */
    gelAmountMinor: MinorUnits,
    /** The bank's GEL equivalent from the statement. */
    bankGelAmountMinor: MinorUnits,
    message: z.string(),
  })
  .meta({ id: 'CommitWarning' });
export type CommitWarning = z.output<typeof CommitWarning>;

export const CommitImportResponse = z
  .object({
    batch: ImportBatch,
    /** Ids of the transactions created, in statement order. */
    transactionIds: z.array(Uuid),
    /** Non-blocking findings about the booked rows, in statement order. Empty when all is well. */
    warnings: z.array(CommitWarning),
  })
  .meta({ id: 'CommitImportResponse' });
export type CommitImportResponse = z.output<typeof CommitImportResponse>;

// ── Transactions ────────────────────────────────────────────────────────────────────────

export const TransactionParams = OrgParams.extend({ transactionId: Uuid });
export type TransactionParams = z.output<typeof TransactionParams>;

/** The NBG rate a posting was converted with. */
export const PostingRate = z
  .object({
    /** GEL per `quantity` units, e.g. `"3.6924"`. */
    rate: RateDecimal,
    quantity: z.int().positive(),
    /** First day the rate applies to: the rate date to show. */
    validFrom: IsoDate,
  })
  .meta({ id: 'PostingRate' });
export type PostingRate = z.output<typeof PostingRate>;

export const TransactionPosting = Posting.extend({
  account: z.object({
    name: z.string(),
    kind: AccountKind,
    systemKey: SystemAccountKey.nullable(),
    incomeClass: IncomeClass.nullable(),
  }),
  /** null for GEL postings. */
  rate: PostingRate.nullable(),
}).meta({ id: 'TransactionPosting' });
export type TransactionPosting = z.output<typeof TransactionPosting>;

/**
 * A transaction with its postings in booking order. For imported lines the first posting is the
 * bank leg: its amount is the original statement amount.
 */
export const TransactionView = Transaction.extend({
  postings: z.array(TransactionPosting).min(2),
  /** The reversing transaction, once this one is reversed. */
  reversedById: Uuid.nullable(),
}).meta({ id: 'TransactionView' });
export type TransactionView = z.output<typeof TransactionView>;

export const ListTransactionsQuery = PaginationQuery.extend({
  /** Inclusive bounds on `occurredOn`. */
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  /** Only transactions with a posting on this account. */
  accountId: Uuid.optional(),
  source: TransactionSource.optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, {
  message: '`from` must not be after `to`',
  path: ['from'],
});
export type ListTransactionsQuery = z.output<typeof ListTransactionsQuery>;

/** Newest `occurredOn` first. */
export const TransactionList = paginated(TransactionView).meta({ id: 'TransactionList' });
export type TransactionList = z.output<typeof TransactionList>;

/** Send `{}` for the defaults. */
export const ReverseTransactionRequest = z
  .object({
    /** Default: the original date, so the correction lands in the same period. */
    occurredOn: IsoDate.optional(),
    /** Default: `Reversal: <original description>`. */
    description: z.string().trim().min(1).max(500).optional(),
  })
  .meta({ id: 'ReverseTransactionRequest' });
export type ReverseTransactionRequest = z.output<typeof ReverseTransactionRequest>;

// ── Declarations and dashboard ──────────────────────────────────────────────────────────

export const YearQuery = z.object({ year: z.coerce.number().int().min(2000).max(9999) });
export type YearQuery = z.output<typeof YearQuery>;

/** `?year=` optional: the current year in Tbilisi by default. */
export const DashboardQuery = z.object({
  year: z.coerce.number().int().min(2000).max(9999).optional(),
});
export type DashboardQuery = z.output<typeof DashboardQuery>;

/** Limit figures shared by the declarations and dashboard responses. */
const LimitFigures = {
  /** The org's small-business status start; null: no status, nothing is declared. */
  sbsEffectiveFrom: IsoDate.nullable(),
  /** GEL 500,000 in tetri, from the tax rules of the year. */
  annualLimitGelMinor: MinorUnits,
  /** Year-to-date SBS income as a share of the limit: 10000 = 100%. */
  annualLimitUsedBp: z.int().nonnegative(),
};

/**
 * `GET /declarations?year=`: computed on request from the ledger (no stored or filed
 * declarations in the MVP). Each month is laid out like the return: `ytdGelMinor` = line 15,
 * `byPaymentMethod` = lines 18–21.
 */
export const DeclarationYearResponse = DeclarationYearFigures.extend({
  ...LimitFigures,
  /** The previous year was over the limit too (feeds `exceeded_second_year`). */
  previousYearLimitExceeded: z.boolean(),
}).meta({ id: 'DeclarationYearResponse' });
export type DeclarationYearResponse = z.output<typeof DeclarationYearResponse>;

export const DashboardMonth = z
  .object({ period: Period, incomeGelMinor: MinorUnits, taxGelMinor: MinorUnits, rateBp: z.int() })
  .meta({ id: 'DashboardMonth' });
export type DashboardMonth = z.output<typeof DashboardMonth>;

export const DashboardResponse = z
  .object({
    year: z.int(),
    ...LimitFigures,
    /** Return line 15 at the end of the year so far. */
    ytdIncomeGelMinor: MinorUnits,
    limitStatus: AnnualLimitStatus,
    /** The latest month of the year with SBS income (or reversals); null when there is none. */
    latestMonth: DeclarationFigures.nullable(),
    /**
     * The next return due on or after today (Tbilisi) among this year's months; null when every
     * deadline of the year has passed or no return is due.
     */
    nextDeadline: z
      .object({
        period: Period,
        deadline: IsoDate,
        taxGelMinor: MinorUnits,
        zeroReturn: z.boolean(),
      })
      .nullable(),
    /** Twelve months, January first, for the income chart. */
    months: z.array(DashboardMonth).length(12),
  })
  .meta({ id: 'DashboardResponse' });
export type DashboardResponse = z.output<typeof DashboardResponse>;
