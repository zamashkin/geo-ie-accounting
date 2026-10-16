// Ledger transactions and their postings (ARCHITECTURE §4). Insert-only: the database rejects
// UPDATE/DELETE on postings and checks the balance at COMMIT (0001_ledger_triggers.sql).
import type {
  AccountKind,
  IncomeClass,
  SystemAccountKey,
  TransactionSource,
} from '@ie-ledger/contracts';
import type { TransactionDraft } from '@ie-ledger/domain';
import { and, desc, eq, exists, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client';
import { accounts, exchangeRates, postings, transactions } from '../schema/index';

export type TransactionRow = typeof transactions.$inferSelect;
export type PostingRow = typeof postings.$inferSelect;

export interface PostingDetail extends PostingRow {
  account: {
    name: string;
    kind: AccountKind;
    systemKey: SystemAccountKey | null;
    incomeClass: IncomeClass | null;
  };
  /** The NBG rate used; null for GEL postings. */
  rate: { rate: string; quantity: number; validFrom: string } | null;
}

export interface TransactionDetail extends TransactionRow {
  postings: PostingDetail[];
  /** The reversal of this transaction, if it was reversed. */
  reversedById: string | null;
}

/**
 * Inserts a transaction built by the domain builders (`bankStatementLine`, `reverse`, ...) with
 * its postings. Call with the request transaction: the deferred balance trigger runs at COMMIT.
 */
export async function insertTransaction(
  tx: Tx,
  orgId: string,
  createdBy: string,
  draft: TransactionDraft,
  opts: { importBatchId?: string | null } = {},
): Promise<TransactionRow> {
  const [row] = await tx
    .insert(transactions)
    .values({
      orgId,
      occurredOn: draft.occurredOn,
      description: draft.description,
      source: draft.source,
      paymentMethod: draft.paymentMethod,
      reversesId: draft.reversesId,
      importBatchId: opts.importBatchId ?? null,
      createdBy,
    })
    .returning();
  if (!row) throw new Error('transaction insert returned no row');
  await tx.insert(postings).values(
    draft.postings.map((p) => ({
      transactionId: row.id,
      orgId,
      accountId: p.accountId,
      amountMinor: p.amountMinor,
      currency: p.currency,
      gelAmountMinor: p.gelAmountMinor,
      rateId: p.rateId,
    })),
  );
  return row;
}

/** Postings with account and rate, plus who reversed what, for a set of transactions. */
async function withPostings(db: DbOrTx, orgId: string, rows: TransactionRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [postingRows, reversals] = await Promise.all([
    db
      .select({
        posting: postings,
        accountName: accounts.name,
        accountKind: accounts.kind,
        accountSystemKey: accounts.systemKey,
        accountIncomeClass: accounts.incomeClass,
        rate: exchangeRates.rate,
        rateQuantity: exchangeRates.quantity,
        rateValidFrom: exchangeRates.validFrom,
      })
      .from(postings)
      .innerJoin(accounts, and(eq(accounts.id, postings.accountId), eq(accounts.orgId, orgId)))
      .leftJoin(exchangeRates, eq(exchangeRates.id, postings.rateId))
      .where(and(eq(postings.orgId, orgId), inArray(postings.transactionId, ids)))
      // uuid v7 ids keep the insert order, which is the builder's order (bank leg first).
      .orderBy(postings.transactionId, postings.id),
    db
      .select({ id: transactions.id, reversesId: transactions.reversesId })
      .from(transactions)
      .where(and(eq(transactions.orgId, orgId), inArray(transactions.reversesId, ids))),
  ]);
  const byTx = new Map<string, PostingDetail[]>();
  for (const r of postingRows) {
    const list = byTx.get(r.posting.transactionId) ?? [];
    list.push({
      ...r.posting,
      account: {
        name: r.accountName,
        kind: r.accountKind,
        systemKey: r.accountSystemKey,
        incomeClass: r.accountIncomeClass,
      },
      rate:
        r.rate !== null && r.rateQuantity !== null && r.rateValidFrom !== null
          ? { rate: r.rate, quantity: r.rateQuantity, validFrom: r.rateValidFrom }
          : null,
    });
    byTx.set(r.posting.transactionId, list);
  }
  const reversedBy = new Map(reversals.map((r) => [r.reversesId, r.id]));
  return rows.map((t): TransactionDetail => ({
    ...t,
    postings: byTx.get(t.id) ?? [],
    reversedById: reversedBy.get(t.id) ?? null,
  }));
}

export async function getTransaction(
  db: DbOrTx,
  orgId: string,
  transactionId: string,
): Promise<TransactionDetail | null> {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.orgId, orgId), eq(transactions.id, transactionId)));
  if (!row) return null;
  const [detail] = await withPostings(db, orgId, [row]);
  return detail ?? null;
}

/** Position in the `occurred_on desc, id desc` order of `listTransactions`. */
export interface TransactionsCursor {
  occurredOn: string;
  id: string;
}

export interface TransactionFilter {
  /** Inclusive bounds on `occurred_on`. */
  from?: string | undefined;
  to?: string | undefined;
  /** Transactions with at least one posting on this account. */
  accountId?: string | undefined;
  source?: TransactionSource | undefined;
}

/** Newest first, keyset-paginated. Returns up to `limit + 1` rows so callers can tell a next page. */
export async function listTransactions(
  db: DbOrTx,
  orgId: string,
  filter: TransactionFilter,
  page: { after?: TransactionsCursor | undefined; limit: number },
): Promise<TransactionDetail[]> {
  const { after } = page;
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.orgId, orgId),
        filter.from ? gte(transactions.occurredOn, filter.from) : undefined,
        filter.to ? lte(transactions.occurredOn, filter.to) : undefined,
        filter.source ? eq(transactions.source, filter.source) : undefined,
        filter.accountId
          ? exists(
              db
                .select({ one: sql`1` })
                .from(postings)
                .where(
                  and(
                    eq(postings.orgId, orgId),
                    eq(postings.transactionId, transactions.id),
                    eq(postings.accountId, filter.accountId),
                  ),
                ),
            )
          : undefined,
        after
          ? or(
              lt(transactions.occurredOn, after.occurredOn),
              and(eq(transactions.occurredOn, after.occurredOn), lt(transactions.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(transactions.occurredOn), desc(transactions.id))
    .limit(page.limit + 1);
  return withPostings(db, orgId, rows);
}

/** Locks a transaction row for the rest of the request transaction (reversal). */
export async function lockTransaction(
  tx: Tx,
  orgId: string,
  transactionId: string,
): Promise<TransactionRow | null> {
  const [row] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.orgId, orgId), eq(transactions.id, transactionId)))
    .for('update');
  return row ?? null;
}
