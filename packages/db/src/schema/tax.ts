import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, minor, timestamptz } from './_columns';
import { users } from './auth';
import { organizations } from './tenancy';

/** SBS income by payment method in GEL minor units, as decimal strings (return lines 18–21). */
export type IncomeByPaymentMethodJson = {
  cash_register: string;
  pos: string;
  bank: string;
  other: string;
};

/**
 * One filed monthly return: an immutable snapshot of the live figures at filing time (insert-only,
 * enforced by trigger). Live figures are never stored; they are computed from postings on every
 * request. Refiling a month inserts a correction with `version + 1` that supersedes the previous
 * filing.
 */
export const declarationFilings = pgTable(
  'declaration_filings',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** 'YYYY-MM' */
    period: char('period', { length: 7 }).notNull(),
    /** 1 = the original return, 2+ = corrections. */
    version: integer('version').notNull(),
    /** The filing this one corrects. */
    supersedesId: uuid('supersedes_id'),
    rulesVersion: text('rules_version').notNull(),
    incomeGelMinor: minor('income_gel_minor').notNull(),
    /** Cumulative SBS income since 1 January (return line 15). */
    ytdGelMinor: minor('ytd_gel_minor').notNull(),
    byPaymentMethod: jsonb('by_payment_method').$type<IncomeByPaymentMethodJson>().notNull(),
    /** 100 = 1%, 300 = 3%. */
    rateBp: integer('rate_bp').notNull(),
    taxGelMinor: minor('tax_gel_minor').notNull(),
    zeroReturn: boolean('zero_return').notNull(),
    /** The transactions behind the figures when filed. */
    transactionIds: uuid('transaction_ids').array().notNull(),
    /** Everything the period view showed, encoded as on the wire, for the record. */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    rsReference: text('rs_reference'),
    filedBy: uuid('filed_by')
      .notNull()
      .references(() => users.id),
    filedAt: timestamptz('filed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('declaration_filings_org_period_version_uq').on(t.orgId, t.period, t.version),
    // A filing is corrected at most once: corrections form a chain, never a tree.
    uniqueIndex('declaration_filings_supersedes_uq')
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} is not null`),
    unique('declaration_filings_id_org_id_uq').on(t.id, t.orgId),
    foreignKey({
      name: 'declaration_filings_supersedes_fk',
      columns: [t.supersedesId, t.orgId],
      foreignColumns: [t.id, t.orgId],
    }),
    check('declaration_filings_period_format', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('declaration_filings_rate_bp_nonnegative', sql`${t.rateBp} >= 0`),
    check(
      'declaration_filings_version_chain',
      sql`(${t.version} = 1) = (${t.supersedesId} is null) and ${t.version} >= 1`,
    ),
  ],
);
