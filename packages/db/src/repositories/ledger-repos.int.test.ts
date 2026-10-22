import { bankStatementLine, money, parseRate } from '@geo-ie-accounting/domain';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exchangeRates, organizations, users } from '../schema/index';
import { DEV, readRateFixture, seedDev, seedDevRates } from '../seed';
import { startTestDatabase, type TestDatabase } from '../testing/index';
import { getDefaultSbsIncomeAccount, listAccounts, matchOrCreateBankAccount } from './accounts';
import { createOrganization } from './orgs';
import { getRateFor, resolveRate, type RateSource } from './rates';
import { listSbsIncomeEntries } from './reports';
import { getTransaction, insertTransaction, listTransactions } from './transactions';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await startTestDatabase();
});

afterAll(async () => {
  await (tdb as TestDatabase | undefined)?.close();
});

async function newOrg() {
  const [user] = await tdb.db
    .insert(users)
    .values({ email: `${uuidv7()}@example.test`, name: 'T' })
    .returning();
  const org = await tdb.db.transaction((tx) => createOrganization(tx, user!.id, { name: 'IE' }));
  return { userId: user!.id, orgId: org.id };
}

describe('seedDevRates', () => {
  it('stores the three GBP rates of the BoG fixture, idempotently', async () => {
    expect(readRateFixture('GBP_2025-06-04.json')).toEqual([
      {
        currency: 'GBP',
        validFrom: '2025-06-04',
        rate: '3.6924',
        quantity: 1,
        setAt: new Date('2025-06-03T13:01:09.015Z'),
      },
    ]);
    const first = await seedDevRates(tdb.db);
    const second = await seedDevRates(tdb.db);
    expect(first.inserted + first.unchanged).toBe(3);
    expect(second).toMatchObject({ inserted: 0, unchanged: 3, conflicts: [] });
    expect((await getRateFor(tdb.db, 'GBP', '2025-06-11'))?.rate).toBe('3.685800');
  });

  it('gives the dev org an SBS start before the fixture dates', async () => {
    await seedDev(tdb.db);
    const [org] = await tdb.db
      .select({ from: organizations.sbsEffectiveFrom })
      .from(organizations)
      .where(eq(organizations.id, DEV.orgId));
    expect(org?.from).toBe('2025-01-01');
  });
});

describe('resolveRate', () => {
  it('uses a row that starts on the date without asking the source', async () => {
    await seedDevRates(tdb.db);
    const calls: string[] = [];
    const source: RateSource = {
      getRates: (date) => {
        calls.push(date);
        return Promise.resolve([]);
      },
    };
    const row = await resolveRate(tdb.db, source, 'GBP', '2025-06-04');
    expect(row.rate).toBe('3.692400');
    expect(calls).toEqual([]);
  });

  it('asks the source for a date the database cannot prove, and stores the answer', async () => {
    const source: RateSource = {
      getRates: (date, currencies) =>
        Promise.resolve(
          currencies.map((currency) => ({
            currency,
            validFrom: '2025-06-07', // Saturday: the rate set on Friday evening
            rate: '3.7000',
            quantity: 1,
            setAt: '2025-06-06T13:00:00.000Z',
          })),
        ),
    };
    const row = await resolveRate(tdb.db, source, 'GBP', '2025-06-08');
    expect(row).toMatchObject({ validFrom: '2025-06-07', rate: '3.700000' });
    await tdb.db.delete(exchangeRates).where(eq(exchangeRates.validFrom, '2025-06-07'));
  });
});

describe('matchOrCreateBankAccount', () => {
  const key = { iban: 'GE59BG0000000123456789', currency: 'GBP' };

  it('claims the unused default account, then matches it on IBAN + currency', async () => {
    const { orgId } = await newOrg();
    const first = await tdb.db.transaction((tx) => matchOrCreateBankAccount(tx, orgId, key, 'bog'));
    expect(first.outcome).toBe('claimed');
    expect(first.before?.name).toBe('Bank GBP');
    expect(first.account).toMatchObject({ ...key, bank: 'bog', name: 'Bank of Georgia GBP' });

    const again = await tdb.db.transaction((tx) => matchOrCreateBankAccount(tx, orgId, key, 'bog'));
    expect(again).toMatchObject({ outcome: 'matched', account: { id: first.account.id } });
  });

  it('creates a new account for another currency of the same IBAN once no default is left', async () => {
    const { orgId } = await newOrg();
    const gbp = await tdb.db.transaction((tx) => matchOrCreateBankAccount(tx, orgId, key, 'bog'));
    const other = await tdb.db.transaction((tx) =>
      matchOrCreateBankAccount(tx, orgId, { ...key, currency: 'CHF' }, 'bog'),
    );
    expect(other.outcome).toBe('created');
    expect(other.account.id).not.toBe(gbp.account.id);
    expect(other.account).toMatchObject({ iban: key.iban, currency: 'CHF', kind: 'asset' });
    const all = await listAccounts(tdb.db, orgId);
    expect(all.filter((a) => a.iban === key.iban)).toHaveLength(2);
  });
});

describe('transactions', () => {
  it('inserts a balanced draft, reads it back with rate and lists SBS income', async () => {
    await seedDevRates(tdb.db);
    const { orgId, userId } = await newOrg();
    const { account: bank } = await tdb.db.transaction((tx) =>
      matchOrCreateBankAccount(tx, orgId, { iban: 'GE00TEST', currency: 'GBP' }, 'bog'),
    );
    const income = await getDefaultSbsIncomeAccount(tdb.db, orgId);
    const rate = await getRateFor(tdb.db, 'GBP', '2025-06-04');
    const draft = bankStatementLine({
      occurredOn: '2025-06-04',
      description: 'Client payment',
      bankAccountId: bank.id,
      counterAccountId: income!.id,
      amount: money(118000n, 'GBP'),
      rate: { id: rate!.id, rateScaled: parseRate(rate!.rate), quantity: rate!.quantity },
      paymentMethod: 'bank',
    });
    const row = await tdb.db.transaction((tx) => insertTransaction(tx, orgId, userId, draft));

    const detail = await getTransaction(tdb.db, orgId, row.id);
    expect(detail?.postings.map((p) => [p.account.name, p.amountMinor, p.gelAmountMinor])).toEqual([
      ['Bank of Georgia GBP', 118000n, 435703n],
      ['Income: Services', -118000n, -435703n],
    ]);
    expect(detail?.postings[0]?.rate).toEqual({
      rate: '3.692400',
      quantity: 1,
      validFrom: '2025-06-04',
    });
    expect(await listSbsIncomeEntries(tdb.db, orgId, 2025)).toEqual([
      { occurredOn: '2025-06-04', gelAmountMinor: -435703n, paymentMethod: 'bank' },
    ]);
    expect(await listSbsIncomeEntries(tdb.db, orgId, 2024)).toEqual([]);

    const page = await listTransactions(tdb.db, orgId, { accountId: bank.id }, { limit: 10 });
    expect(page.map((t) => t.id)).toEqual([row.id]);
    const none = await listTransactions(tdb.db, orgId, { from: '2025-07-01' }, { limit: 10 });
    expect(none).toEqual([]);
    // Another org sees nothing.
    const other = await newOrg();
    expect(await getTransaction(tdb.db, other.orgId, row.id)).toBeNull();
  });
});
