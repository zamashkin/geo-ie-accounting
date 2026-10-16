// Read models for declarations and the dashboard. The figures themselves are computed by
// packages/domain (computeDeclarationYear); this only loads its input.
import type { SbsIncomeEntry } from '@ie-ledger/domain';
import { and, eq, gte, lte } from 'drizzle-orm';
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
