import { z } from 'zod';
import {
  AccountingMethod,
  AccountKind,
  Bank,
  ImportBatchStatus,
  ImportRowStatus,
  IncomeClass,
  InvoiceStatus,
  OperationType,
  ParserId,
  PaymentMethod,
  Role,
  RuleDirection,
  SystemAccountKey,
  TransactionSource,
} from './enums';
import { GenericCsvMapping, ParseWarning } from './importers';
import {
  CurrencyCode,
  Iban,
  IsoDate,
  JsonObject,
  MinorUnits,
  QuantityDecimal,
  RateDecimal,
  Timestamp,
  Uuid,
} from './primitives';

// DTOs for every table in ARCHITECTURE §5, as they appear on the wire (camelCase).
// Request bodies are defined next to their routes' contracts as workstreams add them; reuse
// these with .pick()/.omit() rather than redefining fields.
// Internal tables (fingerprints, idempotency keys, auth tables) have DTOs for tests and tooling;
// they are not exposed by the API.

// ── Identity and tenancy ────────────────────────────────────────────────────────────────

export const User = z
  .object({
    id: Uuid,
    email: z.email(),
    name: z.string(),
    createdAt: Timestamp,
  })
  .meta({ id: 'User' });
export type User = z.output<typeof User>;

export const Organization = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(200),
    taxId: z.string().nullable(),
    baseCurrency: z.literal('GEL'),
    /** Small-business status start; may be mid-month (SPEC §2.1). */
    sbsEffectiveFrom: IsoDate.nullable(),
    accountingMethod: AccountingMethod,
    /** Postal address printed on invoices; may span lines. */
    address: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    /** Prepended to invoice numbers: `INV-` gives `INV-2026-001`. null: `2026-001`. */
    invoicePrefix: z.string().nullable(),
    /** Days from issue to due date when an invoice is issued without one. */
    invoiceDueDays: z.int().min(0).max(365),
    /** Printed at the foot of every invoice (payment terms, a VAT remark). */
    invoiceNote: z.string().nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Organization' });
export type Organization = z.output<typeof Organization>;

export const Membership = z
  .object({
    orgId: Uuid,
    userId: Uuid,
    role: Role,
    createdAt: Timestamp,
  })
  .meta({ id: 'Membership' });
export type Membership = z.output<typeof Membership>;

/** The token hash is never exposed. */
export const Invitation = z
  .object({
    id: Uuid,
    orgId: Uuid,
    email: z.email(),
    role: Role,
    invitedBy: Uuid.nullable(),
    expiresAt: Timestamp,
    acceptedAt: Timestamp.nullable(),
    revokedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Invitation' });
export type Invitation = z.output<typeof Invitation>;

// ── Ledger ──────────────────────────────────────────────────────────────────────────────

export const Account = z
  .object({
    id: Uuid,
    orgId: Uuid,
    name: z.string().min(1).max(200),
    kind: AccountKind,
    /** null = any currency (income/expense); set for bank accounts. */
    currency: CurrencyCode.nullable(),
    systemKey: SystemAccountKey.nullable(),
    /** Only for kind = income, and required there. */
    incomeClass: IncomeClass.nullable(),
    bank: Bank.nullable(),
    iban: Iban.nullable(),
    archivedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Account' });
export type Account = z.output<typeof Account>;

export const ExchangeRate = z
  .object({
    id: Uuid,
    currency: CurrencyCode,
    /** First calendar day the rate applies to (NBG `validFromDate`). */
    validFrom: IsoDate,
    /** GEL per `quantity` units of `currency`. */
    rate: RateDecimal,
    quantity: z.int().positive(),
    source: z.literal('nbg'),
    /** When NBG set the rate (around 17:00 Tbilisi on the previous business day). */
    setAt: Timestamp.nullable(),
    fetchedAt: Timestamp,
  })
  .meta({ id: 'ExchangeRate' });
export type ExchangeRate = z.output<typeof ExchangeRate>;

export const Posting = z
  .object({
    id: Uuid,
    transactionId: Uuid,
    orgId: Uuid,
    accountId: Uuid,
    /** Signed: positive = debit, negative = credit. */
    amountMinor: MinorUnits,
    currency: CurrencyCode,
    gelAmountMinor: MinorUnits,
    /** null for GEL postings (rate 1). */
    rateId: Uuid.nullable(),
  })
  .meta({ id: 'Posting' });
export type Posting = z.output<typeof Posting>;

export const Transaction = z
  .object({
    id: Uuid,
    orgId: Uuid,
    occurredOn: IsoDate,
    description: z.string(),
    notes: z.string().nullable(),
    source: TransactionSource,
    /** Return lines 18–21; required when the transaction posts SBS income. */
    paymentMethod: PaymentMethod.nullable(),
    reversesId: Uuid.nullable(),
    importBatchId: Uuid.nullable(),
    createdBy: Uuid,
    createdAt: Timestamp,
  })
  .meta({ id: 'Transaction' });
export type Transaction = z.output<typeof Transaction>;

export const TransactionWithPostings = Transaction.extend({
  postings: z.array(Posting).min(2),
}).meta({ id: 'TransactionWithPostings' });
export type TransactionWithPostings = z.output<typeof TransactionWithPostings>;

// ── Imports ─────────────────────────────────────────────────────────────────────────────

export const ImportBatchStats = z.object({
  total: z.int().nonnegative(),
  new: z.int().nonnegative(),
  duplicate: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
  committed: z.int().nonnegative(),
  warnings: z.int().nonnegative(),
});
export type ImportBatchStats = z.output<typeof ImportBatchStats>;

export const ImportBatch = z
  .object({
    id: Uuid,
    orgId: Uuid,
    accountId: Uuid,
    bankFormat: ParserId,
    /** Object storage key; null when the file was not stored (MVP, ADR 0012). */
    fileKey: z.string().nullable(),
    fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
    fileName: z.string(),
    status: ImportBatchStatus,
    stats: ImportBatchStats.partial(),
    /** Parser warnings, e.g. `reconciliation_mismatch`. */
    warnings: z.array(ParseWarning),
    /** Statement period from the file header, when it has one. */
    periodFrom: IsoDate.nullable(),
    periodTo: IsoDate.nullable(),
    error: JsonObject.nullable(),
    createdBy: Uuid,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'ImportBatch' });
export type ImportBatch = z.output<typeof ImportBatch>;

export const ImportRow = z
  .object({
    id: Uuid,
    batchId: Uuid,
    orgId: Uuid,
    rowIndex: z.int().nonnegative(),
    raw: JsonObject,
    bookedOn: IsoDate,
    amountMinor: MinorUnits,
    currency: CurrencyCode,
    counterparty: z.string().nullable(),
    counterpartyAccount: z.string().nullable(),
    description: z.string(),
    bankReference: z.string().nullable(),
    /** Statement document number (BoG `Doc N`); the cross-format dedupe key. */
    documentNumber: z.string().nullable(),
    operationType: OperationType,
    bankGelAmountMinor: MinorUnits.nullable(),
    counterAmountMinor: MinorUnits.nullable(),
    counterCurrency: CurrencyCode.nullable(),
    dedupeHash: z.string(),
    status: ImportRowStatus,
    suggestedAccountId: Uuid.nullable(),
    /** The categorisation rule behind `suggestedAccountId`; null for the fixed suggestions. */
    suggestedRuleId: Uuid.nullable(),
    chosenAccountId: Uuid.nullable(),
    transactionId: Uuid.nullable(),
  })
  .meta({ id: 'ImportRow' });
export type ImportRow = z.output<typeof ImportRow>;

/** Internal: one row per committed bank line, the dedupe index. */
export const TransactionFingerprint = z.object({
  orgId: Uuid,
  accountId: Uuid,
  dedupeHash: z.string(),
  transactionId: Uuid,
  createdAt: Timestamp,
});
export type TransactionFingerprint = z.output<typeof TransactionFingerprint>;

/**
 * Suggests `targetAccountId` for an imported line when every condition that is set holds (unset
 * = any). Text conditions are case-insensitive substrings; the amount range is inclusive, on the
 * absolute amount, in minor units of `currency` (so it needs `currency`). The lowest `priority`
 * that matches wins.
 */
export const CategorizationRule = z
  .object({
    id: Uuid,
    orgId: Uuid,
    name: z.string().min(1).max(200),
    priority: z.int(),
    counterpartyContains: z.string().max(200).nullable(),
    descriptionContains: z.string().max(200).nullable(),
    direction: RuleDirection.nullable(),
    currency: CurrencyCode.nullable(),
    amountMinMinor: MinorUnits.nullable(),
    amountMaxMinor: MinorUnits.nullable(),
    targetAccountId: Uuid,
    isActive: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'CategorizationRule' });
export type CategorizationRule = z.output<typeof CategorizationRule>;

export const ColumnMapping = z
  .object({
    id: Uuid,
    orgId: Uuid,
    accountId: Uuid,
    mapping: GenericCsvMapping,
    createdAt: Timestamp,
  })
  .meta({ id: 'ColumnMapping' });
export type ColumnMapping = z.output<typeof ColumnMapping>;

// ── Invoices ────────────────────────────────────────────────────────────────────────────

export const Client = z
  .object({
    id: Uuid,
    orgId: Uuid,
    name: z.string().min(1).max(200),
    taxId: z.string().nullable(),
    /** Postal address; may span lines. */
    address: z.string().nullable(),
    email: z.email().nullable(),
    /** ISO 3166-1 alpha-2. */
    country: z.string().regex(/^[A-Z]{2}$/),
    defaultCurrency: CurrencyCode,
    notes: z.string().nullable(),
    archivedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Client' });
export type Client = z.output<typeof Client>;

export const InvoiceLine = z
  .object({
    id: Uuid,
    invoiceId: Uuid,
    orgId: Uuid,
    position: z.int().nonnegative(),
    description: z.string().min(1),
    quantity: QuantityDecimal,
    unitPriceMinor: MinorUnits,
  })
  .meta({ id: 'InvoiceLine' });
export type InvoiceLine = z.output<typeof InvoiceLine>;

export const Invoice = z
  .object({
    id: Uuid,
    orgId: Uuid,
    clientId: Uuid,
    /**
     * Assigned on issue, gapless per org and year (`2026-001`, with the org prefix if set).
     * null while draft; a void invoice keeps its number.
     */
    number: z.string().nullable(),
    /** Year and sequence behind `number`. */
    numberYear: z.int().nullable(),
    numberSeq: z.int().positive().nullable(),
    issueDate: IsoDate.nullable(),
    dueDate: IsoDate.nullable(),
    currency: CurrencyCode,
    status: InvoiceStatus,
    /** The bank account whose IBAN is printed for payment. */
    bankAccountId: Uuid.nullable(),
    notes: z.string().nullable(),
    /** Σ line totals (domain computeInvoiceTotals), minor units of `currency`. */
    totalMinor: MinorUnits,
    issuedAt: Timestamp.nullable(),
    voidedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Invoice' });
export type Invoice = z.output<typeof Invoice>;

/** A share of an incoming bank transaction allocated to an invoice. */
export const InvoicePayment = z
  .object({
    invoiceId: Uuid,
    transactionId: Uuid,
    orgId: Uuid,
    amountMinor: MinorUnits,
    createdAt: Timestamp,
  })
  .meta({ id: 'InvoicePayment' });
export type InvoicePayment = z.output<typeof InvoicePayment>;

// ── Tax ─────────────────────────────────────────────────────────────────────────────────

/** SBS income by payment method, GEL minor units: return lines 18–21. */
export const IncomeByPaymentMethod = z
  .object({
    cash_register: MinorUnits,
    pos: MinorUnits,
    bank: MinorUnits,
    other: MinorUnits,
  })
  .meta({ id: 'IncomeByPaymentMethod' });
export type IncomeByPaymentMethod = z.output<typeof IncomeByPaymentMethod>;

// ── Cross-cutting ───────────────────────────────────────────────────────────────────────

export const AuditLogEntry = z
  .object({
    id: Uuid,
    orgId: Uuid,
    /** null for system actions (worker jobs). */
    actorId: Uuid.nullable(),
    action: z.string(),
    entity: z.string(),
    entityId: z.string().nullable(),
    before: JsonObject.nullable(),
    after: JsonObject.nullable(),
    requestId: z.string().nullable(),
    at: Timestamp,
  })
  .meta({ id: 'AuditLogEntry' });
export type AuditLogEntry = z.output<typeof AuditLogEntry>;

/** Internal: stored responses for `Idempotency-Key` replays. */
export const IdempotencyKeyRecord = z.object({
  orgId: Uuid,
  key: z.string().min(1).max(255),
  requestHash: z.string(),
  statusCode: z.int().nullable(),
  response: z.unknown().nullable(),
  createdAt: Timestamp,
});
export type IdempotencyKeyRecord = z.output<typeof IdempotencyKeyRecord>;
