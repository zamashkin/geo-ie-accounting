import type { SystemAccountKey } from '@ie-ledger/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, currency, id, minor, timestamptz } from './_columns';
import { users } from './auth';
import {
  accountKindEnum,
  bankEnum,
  incomeClassEnum,
  paymentMethodEnum,
  transactionSourceEnum,
} from './enums';
import { importBatches } from './imports';
import { organizations } from './tenancy';

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: accountKindEnum('kind').notNull(),
    /** null = any currency (income/expense); set for bank accounts. */
    currency: currency('currency'),
    /** 'fx_clearing' | 'tax_payable' | 'owner_equity'. Unique per org. */
    systemKey: text('system_key').$type<SystemAccountKey>(),
    /** Required for kind = income, forbidden otherwise. */
    incomeClass: incomeClassEnum('income_class'),
    bank: bankEnum('bank'),
    iban: text('iban'),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('accounts_org_id_idx').on(t.orgId),
    uniqueIndex('accounts_org_system_key_uq')
      .on(t.orgId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
    // Statement imports match bank accounts on IBAN + currency: BoG uses one IBAN for all of a
    // client's currency accounts (docs/tasks/README.md, WS-07 follow-up).
    uniqueIndex('accounts_org_iban_currency_uq')
      .on(t.orgId, t.iban, t.currency)
      .where(sql`${t.iban} is not null`),
    // Composite target for postings' (account_id, org_id) FK: a posting cannot point at
    // another org's account.
    unique('accounts_id_org_id_uq').on(t.id, t.orgId),
    check(
      'accounts_income_class_only_for_income',
      sql`(${t.kind} = 'income') = (${t.incomeClass} is not null)`,
    ),
  ],
);

export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: id(),
    currency: currency('currency').notNull(),
    /** First day the rate applies to (NBG validFromDate). Lookup for D: max(valid_from) <= D. */
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    /** GEL per `quantity` units. */
    rate: numeric('rate', { precision: 18, scale: 6, mode: 'string' }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    source: text('source').notNull().default('nbg'),
    /** When NBG set the rate (~17:00 Tbilisi the business day before), if known. */
    setAt: timestamptz('set_at'),
    fetchedAt: timestamptz('fetched_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('exchange_rates_currency_valid_from_uq').on(t.currency, t.validFrom),
    check('exchange_rates_rate_positive', sql`${t.rate} > 0`),
    check('exchange_rates_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    description: text('description').notNull(),
    notes: text('notes'),
    source: transactionSourceEnum('source').notNull(),
    /** Return lines 18–21. Required when the transaction posts SBS income (checked by trigger). */
    paymentMethod: paymentMethodEnum('payment_method'),
    reversesId: uuid('reverses_id').references((): AnyPgColumn => transactions.id),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('transactions_org_occurred_on_idx').on(t.orgId, t.occurredOn, t.id),
    // A transaction can be reversed once.
    uniqueIndex('transactions_reverses_id_uq')
      .on(t.reversesId)
      .where(sql`${t.reversesId} is not null`),
    unique('transactions_id_org_id_uq').on(t.id, t.orgId),
    check(
      'transactions_reversal_source',
      sql`(${t.source} = 'reversal') = (${t.reversesId} is not null)`,
    ),
  ],
);

/**
 * Insert-only (trigger). Per transaction, amounts sum to zero per currency (deferred trigger).
 * Sign: positive = debit, negative = credit.
 */
export const postings = pgTable(
  'postings',
  {
    id: id(),
    transactionId: uuid('transaction_id').notNull(),
    orgId: uuid('org_id').notNull(),
    accountId: uuid('account_id').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: currency('currency').notNull(),
    gelAmountMinor: minor('gel_amount_minor').notNull(),
    /** null for GEL postings (rate 1). */
    rateId: uuid('rate_id').references(() => exchangeRates.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('postings_transaction_id_idx').on(t.transactionId),
    index('postings_org_account_idx').on(t.orgId, t.accountId),
    // Composite FKs keep the posting, its transaction and its account in the same org.
    foreignKey({
      name: 'postings_transaction_fk',
      columns: [t.transactionId, t.orgId],
      foreignColumns: [transactions.id, transactions.orgId],
    }),
    foreignKey({
      name: 'postings_account_fk',
      columns: [t.accountId, t.orgId],
      foreignColumns: [accounts.id, accounts.orgId],
    }),
    check('postings_amount_nonzero', sql`${t.amountMinor} <> 0`),
    check(
      'postings_gel_amount_matches_for_gel',
      sql`${t.currency} <> 'GEL' or (${t.gelAmountMinor} = ${t.amountMinor} and ${t.rateId} is null)`,
    ),
  ],
);
