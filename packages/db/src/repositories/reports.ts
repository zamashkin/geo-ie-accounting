// Read models for declarations and the dashboard. The figures themselves are computed by
// packages/domain (computeDeclarationYear); this only loads its input.
import type { SbsIncomeEntry } from '@ie-ledger/domain';
import { and, eq, gte, lte, max } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import { accounts, postings, transactions } from '../schema/index';

/**
 * Every posting on an `sbs` income account dated in `year`, with its transaction's date and
 * payment method: the input of `computeDeclarationYear`. Reversals are included (they carry
 * the opposite sign), so reversed income nets out.
 */
export async function listSbsIncomeEntries(
  db: DbOrTx,
  orgId: string,
  year: number,
): Promise<SbsIncomeEntry[]> {
  const y = String(year).padStart(4, '0');
  return db
    .select({
      occurredOn: transactions.occurredOn,
      gelAmountMinor: postings.gelAmountMinor,
      paymentMethod: transactions.paymentMethod,
    })
    .from(postings)
    .innerJoin(
      transactions,
      and(eq(transactions.id, postings.transactionId), eq(transactions.orgId, orgId)),
    )
    .innerJoin(accounts, and(eq(accounts.id, postings.accountId), eq(accounts.orgId, orgId)))
    .where(
      and(
        eq(postings.orgId, orgId),
        eq(accounts.incomeClass, 'sbs'),
        gte(transactions.occurredOn, `${y}-01-01`),
        lte(transactions.occurredOn, `${y}-12-31`),
      ),
    );
}

/**
 * The year of the org's latest posted transaction (any source, reversals included), or null
 * when it has none. The declarations and dashboard open on this year by default.
 */
export async function latestTransactionYear(db: DbOrTx, orgId: string): Promise<number | null> {
  const [row] = await db
    .select({ latest: max(transactions.occurredOn) })
    .from(transactions)
    .where(eq(transactions.orgId, orgId));
  const latest = row?.latest ?? null;
  return latest === null ? null : Number(latest.slice(0, 4));
}
