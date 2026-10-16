import type { GenericCsvMapping, ImportBatchStats, ParseWarning } from '@ie-ledger/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, currency, id, minor, timestamptz } from './_columns';
import { users } from './auth';
import {
  importBatchStatusEnum,
  importRowStatusEnum,
  operationTypeEnum,
  parserIdEnum,
  ruleFieldEnum,
  ruleOpEnum,
} from './enums';
import { accounts, transactions } from './ledger';
import { organizations } from './tenancy';

const orgId = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

export const importBatches = pgTable(
  'import_batches',
  {
    id: id(),
    orgId: orgId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    bankFormat: parserIdEnum('bank_format').notNull(),
    /**
     * Object storage key of the encrypted upload. null: the file was not stored (the MVP parses
     * the request body and keeps only the parsed rows, ADR 0012).
     */
    fileKey: text('file_key'),
    fileSha256: text('file_sha256').notNull(),
    fileName: text('file_name').notNull(),
    status: importBatchStatusEnum('status').notNull().default('uploaded'),
    stats: jsonb('stats').$type<Partial<ImportBatchStats>>().notNull().default({}),
    /** Parser warnings (contracts ParseWarning). May quote statement text: never log. */
    warnings: jsonb('warnings').$type<ParseWarning[]>().notNull().default([]),
    /** Statement period from the file header, when it has one. */
    periodFrom: date('period_from', { mode: 'string' }),
    periodTo: date('period_to', { mode: 'string' }),
    error: jsonb('error').$type<Record<string, unknown>>(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('import_batches_org_id_idx').on(t.orgId, t.createdAt),
    // Same-file re-upload detection (WS-07).
    index('import_batches_org_account_sha_idx').on(t.orgId, t.accountId, t.fileSha256),
    check('import_batches_sha256_hex', sql`${t.fileSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const importRows = pgTable(
  'import_rows',
  {
    id: id(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    orgId: orgId(),
    rowIndex: integer('row_index').notNull(),
    /** Raw cells. Personal data: never log. */
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
    bookedOn: date('booked_on', { mode: 'string' }).notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: currency('currency').notNull(),
    counterparty: text('counterparty'),
    counterpartyAccount: text('counterparty_account'),
    description: text('description').notNull(),
    bankReference: text('bank_reference'),
    /** Statement document number; the cross-format dedupe key (domain documentDedupeHash). */
    documentNumber: text('document_number'),
    operationType: operationTypeEnum('operation_type').notNull().default('other'),
    bankGelAmountMinor: minor('bank_gel_amount_minor'),
    counterAmountMinor: minor('counter_amount_minor'),
    counterCurrency: currency('counter_currency'),
    dedupeHash: text('dedupe_hash').notNull(),
    status: importRowStatusEnum('status').notNull(),
    suggestedAccountId: uuid('suggested_account_id').references(() => accounts.id),
    chosenAccountId: uuid('chosen_account_id').references(() => accounts.id),
    transactionId: uuid('transaction_id').references(() => transactions.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('import_rows_batch_row_uq').on(t.batchId, t.rowIndex),
    index('import_rows_org_id_idx').on(t.orgId),
  ],
);

/** Dedupe index: one row per committed bank line (ARCHITECTURE §6). */
export const transactionFingerprints = pgTable(
  'transaction_fingerprints',
  {
    orgId: orgId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    dedupeHash: text('dedupe_hash').notNull(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.accountId, t.dedupeHash] })],
);

export const categorizationRules = pgTable(
  'categorization_rules',
  {
    id: id(),
    orgId: orgId(),
    priority: integer('priority').notNull().default(100),
    field: ruleFieldEnum('field').notNull(),
    op: ruleOpEnum('op').notNull(),
    value: text('value').notNull(),
    targetAccountId: uuid('target_account_id')
      .notNull()
      .references(() => accounts.id),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('categorization_rules_org_priority_idx').on(t.orgId, t.priority)],
);

export const columnMappings = pgTable(
  'column_mappings',
  {
    id: id(),
    orgId: orgId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    mapping: jsonb('mapping').$type<GenericCsvMapping>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('column_mappings_org_account_uq').on(t.orgId, t.accountId)],
);
