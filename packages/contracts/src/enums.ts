import { z } from 'zod';

// Enum values shared by the API, the worker and the database (packages/db builds its pgEnums
// from these arrays, so the two cannot drift).

export const ROLES = ['owner', 'accountant', 'viewer'] as const;
export const Role = z.enum(ROLES);
export type Role = z.output<typeof Role>;

export const ACCOUNTING_METHODS = ['cash'] as const;
export const AccountingMethod = z.enum(ACCOUNTING_METHODS);
export type AccountingMethod = z.output<typeof AccountingMethod>;

export const ACCOUNT_KINDS = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export const AccountKind = z.enum(ACCOUNT_KINDS);
export type AccountKind = z.output<typeof AccountKind>;

/** `sbs`: 1% small-business income that counts toward the limit. `non_sbs`: rental, interest, ... */
export const INCOME_CLASSES = ['sbs', 'non_sbs'] as const;
export const IncomeClass = z.enum(INCOME_CLASSES);
export type IncomeClass = z.output<typeof IncomeClass>;

export const SYSTEM_ACCOUNT_KEYS = ['fx_clearing', 'tax_payable', 'owner_equity'] as const;
export const SystemAccountKey = z.enum(SYSTEM_ACCOUNT_KEYS);
export type SystemAccountKey = z.output<typeof SystemAccountKey>;

export const BANKS = ['tbc', 'bog', 'other'] as const;
export const Bank = z.enum(BANKS);
export type Bank = z.output<typeof Bank>;

export const TRANSACTION_SOURCES = ['manual', 'import', 'invoice_payment', 'reversal'] as const;
export const TransactionSource = z.enum(TRANSACTION_SOURCES);
export type TransactionSource = z.output<typeof TransactionSource>;

/** Return lines 18–21 (SPEC §2.4): cash register, POS terminal, bank account, other. */
export const PAYMENT_METHODS = ['cash_register', 'pos', 'bank', 'other'] as const;
export const PaymentMethod = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.output<typeof PaymentMethod>;

export const PARSER_IDS = ['tbc-csv', 'tbc-xlsx', 'bog-csv', 'bog-xlsx', 'generic-csv'] as const;
export const ParserId = z.enum(PARSER_IDS);
export type ParserId = z.output<typeof ParserId>;

export const IMPORT_BATCH_STATUSES = [
  'uploaded',
  'parsing',
  'preview',
  'committing',
  'committed',
  'failed',
] as const;
export const ImportBatchStatus = z.enum(IMPORT_BATCH_STATUSES);
export type ImportBatchStatus = z.output<typeof ImportBatchStatus>;

export const IMPORT_ROW_STATUSES = ['new', 'duplicate', 'skipped'] as const;
export const ImportRowStatus = z.enum(IMPORT_ROW_STATUSES);
export type ImportRowStatus = z.output<typeof ImportRowStatus>;

/**
 * Normalised bank operation type (bog/FORMAT.md): BoG `PMI` → incoming_payment,
 * `CCO` → fx_conversion, unknown codes → other (+ a parse warning).
 */
export const OPERATION_TYPES = [
  'incoming_payment',
  'outgoing_payment',
  'fx_conversion',
  'fee',
  'other',
] as const;
export const OperationType = z.enum(OPERATION_TYPES);
export type OperationType = z.output<typeof OperationType>;

export const RULE_FIELDS = ['counterparty', 'description'] as const;
export const RuleField = z.enum(RULE_FIELDS);
export type RuleField = z.output<typeof RuleField>;

export const RULE_OPS = ['contains', 'equals', 'regex'] as const;
export const RuleOp = z.enum(RULE_OPS);
export type RuleOp = z.output<typeof RuleOp>;

export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;
export const InvoiceStatus = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.output<typeof InvoiceStatus>;

export const DECLARATION_STATUSES = ['draft', 'filed'] as const;
export const DeclarationStatus = z.enum(DECLARATION_STATUSES);
export type DeclarationStatus = z.output<typeof DeclarationStatus>;
