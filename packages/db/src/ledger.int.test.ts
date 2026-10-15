import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedChartOfAccounts } from './chart-of-accounts';
import { accounts, organizations, postings, transactions } from './schema/index';
import { DEMO, seedDemo } from './seed';
import { startTestDatabase, type TestDatabase } from './testing/index';

let tdb: TestDatabase;
let account: Record<string, string>;

/** Finds the Postgres error (code, constraint) under Drizzle's wrapping. */
function pgError(e: unknown): { code?: string; constraint?: string; message: string } {
  let current: unknown = e;
  while (current instanceof Error) {
    if ('code' in current && typeof current.code === 'string' && current.code.length === 5) {
      return current as { code: string; constraint?: string; message: string };
    }
    current = current.cause;
  }
  throw e;
}

async function expectPgError(p: Promise<unknown>, code: string, constraint?: string) {
  const err = await p.then(
    () => {
      throw new Error('expected the database to reject this');
    },
    (e: unknown) => pgError(e),
  );
  expect(err.code).toBe(code);
  if (constraint) expect(err.constraint).toBe(constraint);
}

type PostingInput = { account: string; amount: bigint; currency: string; gel?: bigint };

/** Inserts a transaction and its postings in one DB transaction (the deferred checks run at COMMIT). */
async function post(
  lines: PostingInput[],
  opts: { paymentMethod?: 'bank' | null; orgId?: string } = {},
) {
  const orgId = opts.orgId ?? DEMO.orgId;
  return tdb.db.transaction(async (tx) => {
    const [t] = await tx
      .insert(transactions)
      .values({
        orgId,
        occurredOn: '2025-06-04',
        description: 'test',
        source: 'manual',
        paymentMethod: opts.paymentMethod === undefined ? 'bank' : opts.paymentMethod,
        createdBy: DEMO.userId,
      })
      .returning();
    if (lines.length > 0) {
      await tx.insert(postings).values(
        lines.map((l) => ({
          transactionId: t!.id,
          orgId,
          accountId: l.account,
          amountMinor: l.amount,
          currency: l.currency,
          gelAmountMinor: l.gel ?? l.amount,
        })),
      );
    }
    return t!;
  });
}

beforeAll(async () => {
  tdb = await startTestDatabase();
  await seedDemo(tdb.db);
  const rows = await tdb.db.select().from(accounts).where(eq(accounts.orgId, DEMO.orgId));
  account = Object.fromEntries(rows.map((a) => [a.name, a.id]));
});

afterAll(async () => {
  // undefined when startTestDatabase() failed in beforeAll
  await (tdb as TestDatabase | undefined)?.close();
});

describe('seed', () => {
  it('creates one user, one org and the chart of accounts, and is idempotent', async () => {
    const again = await seedDemo(tdb.db);
    expect(again.createdOrg).toBe(false);
    const [{ count }] = (
      await tdb.db.execute<{ count: string }>(
        sql`select count(*)::text as count from accounts where org_id = ${DEMO.orgId}`,
      )
    ).rows as [{ count: string }];
    expect(Number(count)).toBe(12);
  });
});

describe('balance trigger', () => {
  it('accepts a balanced income receipt (USD 1,000.00)', async () => {
    const t = await post([
      { account: account['Bank USD']!, amount: 100000n, currency: 'USD', gel: 271230n },
      { account: account['Income: Services']!, amount: -100000n, currency: 'USD', gel: -271230n },
    ]);
    const rows = await tdb.db.select().from(postings).where(eq(postings.transactionId, t.id));
    expect(rows.map((r) => r.amountMinor).sort()).toEqual([-100000n, 100000n]);
    expect(typeof rows[0]!.amountMinor).toBe('bigint');
  });

  it('rejects an unbalanced transaction at commit', async () => {
    await expectPgError(
      post([
        { account: account['Bank USD']!, amount: 100000n, currency: 'USD' },
        { account: account['Income: Services']!, amount: -90000n, currency: 'USD' },
      ]),
      '23514',
      'transaction_balanced',
    );
  });

  it('rejects a transaction that nets to zero across currencies but not per currency', async () => {
    await expectPgError(
      post([
        { account: account['Bank USD']!, amount: 50000n, currency: 'USD' },
        { account: account['Bank GEL']!, amount: -50000n, currency: 'GEL' },
      ]),
      '23514',
      'transaction_balanced',
    );
  });

  it('accepts an FX conversion balanced per currency through FX Clearing', async () => {
    await post(
      [
        { account: account['Bank USD']!, amount: -50000n, currency: 'USD', gel: -135000n },
        { account: account['FX Clearing']!, amount: 50000n, currency: 'USD', gel: 135000n },
        { account: account['FX Clearing']!, amount: -135000n, currency: 'GEL' },
        { account: account['Bank GEL']!, amount: 135000n, currency: 'GEL' },
      ],
      { paymentMethod: null },
    );
  });

  it('rejects a transaction with a single posting', async () => {
    await expectPgError(
      post([{ account: account['Bank USD']!, amount: 1n, currency: 'USD' }]),
      '23514',
      'transaction_min_postings',
    );
  });

  it('rejects a transaction with no postings', async () => {
    await expectPgError(post([]), '23514', 'transaction_min_postings');
  });

  it('rejects SBS income without a payment method', async () => {
    await expectPgError(
      post(
        [
          { account: account['Bank USD']!, amount: 100n, currency: 'USD' },
          { account: account['Income: Services']!, amount: -100n, currency: 'USD' },
        ],
        { paymentMethod: null },
      ),
      '23514',
      'transaction_payment_method_required',
    );
  });

  it("rejects a posting to another org's account", async () => {
    const otherOrg = uuidv7();
    await tdb.db.insert(organizations).values({ id: otherOrg, name: 'Other IE' });
    const [otherAccount] = await seedChartOfAccounts(tdb.db, otherOrg);
    await expectPgError(
      post([
        { account: otherAccount!.id, amount: 100n, currency: 'GEL' },
        { account: account['Bank GEL']!, amount: -100n, currency: 'GEL' },
      ]),
      '23503',
      'postings_account_fk',
    );
  });
});

describe('immutability triggers', () => {
  let txId: string;
  let postingId: string;

  beforeAll(async () => {
    const t = await post(
      [
        { account: account['Bank GEL']!, amount: 5000n, currency: 'GEL' },
        { account: account['Owner Equity']!, amount: -5000n, currency: 'GEL' },
      ],
      { paymentMethod: null },
    );
    txId = t.id;
    const [p] = await tdb.db.select().from(postings).where(eq(postings.transactionId, txId));
    postingId = p!.id;
  });

  it('rejects updating a posting', async () => {
    await expectPgError(
      tdb.db.update(postings).set({ amountMinor: 1n }).where(eq(postings.id, postingId)),
      '23001',
      'ledger_immutable',
    );
  });

  it('rejects deleting a posting', async () => {
    await expectPgError(
      tdb.db.delete(postings).where(eq(postings.id, postingId)),
      '23001',
      'ledger_immutable',
    );
  });

  it('rejects truncating postings', async () => {
    await expectPgError(
      tdb.db.execute(sql`truncate postings cascade`),
      '23001',
      'ledger_immutable',
    );
  });

  it('allows editing description and notes of a transaction', async () => {
    await tdb.db
      .update(transactions)
      .set({ description: 'Owner top-up', notes: 'checked' })
      .where(eq(transactions.id, txId));
    const [t] = await tdb.db.select().from(transactions).where(eq(transactions.id, txId));
    expect(t!.notes).toBe('checked');
  });

  it('rejects changing financial fields of a transaction', async () => {
    await expectPgError(
      tdb.db
        .update(transactions)
        .set({ occurredOn: '2025-07-01' })
        .where(eq(transactions.id, txId)),
      '23001',
      'ledger_immutable',
    );
  });

  it('rejects deleting a transaction', async () => {
    await expectPgError(
      tdb.db
        .delete(transactions)
        .where(and(eq(transactions.id, txId), eq(transactions.orgId, DEMO.orgId))),
      '23001',
      'ledger_immutable',
    );
  });

  it('accepts a reversing transaction', async () => {
    await tdb.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(transactions)
        .values({
          orgId: DEMO.orgId,
          occurredOn: '2025-06-05',
          description: 'Reversal',
          source: 'reversal',
          reversesId: txId,
          createdBy: DEMO.userId,
        })
        .returning();
      await tx.insert(postings).values([
        {
          transactionId: r!.id,
          orgId: DEMO.orgId,
          accountId: account['Bank GEL']!,
          amountMinor: -5000n,
          currency: 'GEL',
          gelAmountMinor: -5000n,
        },
        {
          transactionId: r!.id,
          orgId: DEMO.orgId,
          accountId: account['Owner Equity']!,
          amountMinor: 5000n,
          currency: 'GEL',
          gelAmountMinor: 5000n,
        },
      ]);
    });
    const reversals = await tdb.db
      .select()
      .from(transactions)
      .where(eq(transactions.reversesId, txId));
    expect(reversals).toHaveLength(1);
  });

  it('rejects reversing the same transaction twice', async () => {
    await expectPgError(
      tdb.db.insert(transactions).values({
        orgId: DEMO.orgId,
        occurredOn: '2025-06-06',
        description: 'Second reversal',
        source: 'reversal',
        reversesId: txId,
        createdBy: DEMO.userId,
      }),
      '23505',
      'transactions_reverses_id_uq',
    );
  });
});
