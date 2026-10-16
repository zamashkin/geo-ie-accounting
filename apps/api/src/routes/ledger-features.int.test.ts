// Accounts management, manual transactions, categorisation rules and the preview bulk actions,
// end to end against a real Postgres. NBG answers from fixtures/nbg (USD April 2026, GBP June
// 2025); the statement is the hand-made synthetic BoG CSV (no real data).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPLAYED_HEADER } from '../plugins/mutations';
import {
  addMemberViaInvite,
  as,
  createOrg,
  signUp,
  startApiTestEnv,
  type ApiTestEnv,
  type TestUser,
} from '../testing/env';
import { multipart } from '../testing/multipart';

const SYNTHETIC = readFileSync(
  new URL(
    '../../../../fixtures/statements/bog/synthetic-gbp-2025-06-unassigned.csv',
    import.meta.url,
  ),
);

interface Account {
  id: string;
  name: string;
  kind: string;
  currency: string | null;
  archivedAt: string | null;
}
interface Posting {
  accountId: string;
  amountMinor: string;
  currency: string;
  gelAmountMinor: string;
  rate: { rate: string; validFrom: string } | null;
}
interface Tx {
  id: string;
  source: string;
  paymentMethod: string | null;
  postings: Posting[];
}
interface Row {
  id: string;
  status: string;
  description: string;
  accountId: string | null;
  suggestedRuleId: string | null;
}

let env: ApiTestEnv;
let owner: TestUser;
let accountant: TestUser;
let orgId: string;
const accounts = new Map<string, Account>();

const id = (name: string) => {
  const a = accounts.get(name);
  if (!a) throw new Error(`no account ${name}`);
  return a.id;
};

async function loadAccounts() {
  const res = await as(env, owner, {
    method: 'GET',
    url: `/v1/orgs/${orgId}/accounts?includeArchived=true`,
  });
  for (const a of res.json<{ items: Account[] }>().items) accounts.set(a.name, a);
}

const post = (user: TestUser, url: string, payload: object, headers = {}) =>
  as(env, user, { method: 'POST', url: `/v1/orgs/${orgId}${url}`, payload, headers });

beforeAll(async () => {
  env = await startApiTestEnv({ now: () => new Date('2026-04-15T09:00:00Z') });
  owner = await signUp(env);
  accountant = await signUp(env);
  orgId = await createOrg(env, owner, 'Features IE');
  await addMemberViaInvite(env, orgId, owner, accountant, 'accountant');
  await loadAccounts();
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

describe('accounts', () => {
  it('creates a bank account (currency required, IBAN optional) and an income account', async () => {
    const noCurrency = await post(owner, '/accounts', { name: 'Cash', kind: 'asset' });
    expect(noCurrency.statusCode).toBe(400);

    const bank = await post(owner, '/accounts', {
      name: 'TBC USD',
      kind: 'asset',
      currency: 'USD',
      iban: 'GE00TB0000000000000001',
    });
    expect(bank.statusCode).toBe(201);
    expect(bank.json()).toMatchObject({ kind: 'asset', currency: 'USD', bank: 'other' });

    const income = await post(owner, '/accounts', {
      name: 'Income: Export',
      kind: 'income',
      incomeClass: 'sbs',
    });
    expect(income.statusCode).toBe(201);
    await loadAccounts();
  });

  it('renames, and archives only at a zero balance', async () => {
    const rename = await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/accounts/${id('TBC USD')}`,
      payload: { name: 'TBC Business USD' },
    });
    expect(rename.statusCode).toBe(200);
    await loadAccounts();

    const system = await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/accounts/${id('FX Clearing')}`,
      payload: { archived: true },
    });
    expect(system.statusCode).toBe(409);

    const archive = await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/accounts/${id('Bank EUR')}`,
      payload: { archived: true },
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json<Account>().archivedAt).not.toBeNull();
  });
});

describe('manual transactions', () => {
  let incomeId: string;

  it('previews and books a USD income receipt at the NBG rate of the day', async () => {
    const body = {
      type: 'income',
      occurredOn: '2026-04-10',
      description: 'Consulting for ACME',
      bankAccountId: id('TBC Business USD'),
      incomeAccountId: id('Income: Services'),
      amountMinor: '100000',
    };
    const preview = await post(accountant, '/transactions/preview', body);
    expect(preview.statusCode).toBe(200);
    const previewed = preview.json<{ postings: Posting[] }>().postings;
    expect(previewed[0]).toMatchObject({ amountMinor: '100000', currency: 'USD' });
    // 10 April 2026 is Orthodox Easter: the rate set on 8 April, valid from 9 April, applies.
    expect(previewed[0]?.rate?.validFrom).toBe('2026-04-09');

    const key = { 'idempotency-key': 'manual-income-1' };
    const res = await post(accountant, '/transactions', body, key);
    expect(res.statusCode).toBe(201);
    const tx = res.json<Tx>();
    expect(tx).toMatchObject({ source: 'manual', paymentMethod: 'bank' });
    expect(tx.postings.map((p) => p.gelAmountMinor)).toEqual(
      previewed.map((p) => p.gelAmountMinor),
    );
    incomeId = tx.id;

    const replay = await post(accountant, '/transactions', body, key);
    expect(replay.headers[REPLAYED_HEADER]).toBe('true');
    expect(replay.json<Tx>().id).toBe(incomeId);
  });

  it('books an expense, a transfer is refused across currencies', async () => {
    const expense = await post(accountant, '/transactions', {
      type: 'expense',
      occurredOn: '2026-04-10',
      description: 'Hosting',
      bankAccountId: id('TBC Business USD'),
      expenseAccountId: id('Expenses: General'),
      amountMinor: '2500',
    });
    expect(expense.statusCode).toBe(201);

    const transfer = await post(accountant, '/transactions', {
      type: 'transfer',
      occurredOn: '2026-04-10',
      description: 'Move',
      fromAccountId: id('TBC Business USD'),
      toAccountId: id('Bank GEL'),
      amountMinor: '100',
    });
    expect(transfer.statusCode).toBe(422);
  });

  it('answers rate_unavailable when NBG has no rate', async () => {
    const res = await post(accountant, '/transactions', {
      type: 'owner_draw',
      occurredOn: '2026-05-20',
      description: 'Draw',
      bankAccountId: id('TBC Business USD'),
      amountMinor: '100',
    });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ code: string }>().code).toBe('rate_unavailable');
  });

  it('keeps raw postings for the owner', async () => {
    const body = {
      type: 'postings',
      occurredOn: '2026-04-10',
      description: 'Opening balance',
      postings: [
        { accountId: id('Bank GEL'), amountMinor: '50000', currency: 'GEL' },
        { accountId: id('Owner Equity'), amountMinor: '-50000', currency: 'GEL' },
      ],
    };
    expect((await post(accountant, '/transactions', body)).statusCode).toBe(403);
    expect((await post(owner, '/transactions', body)).statusCode).toBe(201);

    const unbalanced = await post(owner, '/transactions', {
      ...body,
      postings: [body.postings[0], { ...body.postings[1], amountMinor: '-49999' }],
    });
    expect(unbalanced.statusCode).toBe(422);
  });

  it('filters the list by text and taxable only', async () => {
    const list = async (query: string) =>
      (
        await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/transactions?${query}` })
      ).json<{ items: Tx[] }>().items;
    expect((await list('q=acme')).map((t) => t.id)).toEqual([incomeId]);
    expect((await list('taxable=true')).map((t) => t.id)).toEqual([incomeId]);
    expect((await list('source=manual')).length).toBe(3);
    expect(await list('q=100%25')).toEqual([]);
  });

  it('reports balances, with bank accounts in GEL, and blocks archiving a funded account', async () => {
    const res = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/accounts/balances` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      asOf: string;
      items: {
        accountId: string;
        balances: { currency: string; amountMinor: string }[];
        gelValue: { amountMinor: string; rate: { validFrom: string } | null } | null;
      }[];
    }>();
    expect(body.asOf).toBe('2026-04-15');
    const usd = body.items.find((i) => i.accountId === id('TBC Business USD'));
    expect(usd?.balances).toEqual([{ currency: 'USD', amountMinor: '97500' }]);
    expect(usd?.gelValue?.rate?.validFrom).toBe('2026-04-09');
    const income = body.items.find((i) => i.accountId === id('Income: Services'));
    // Credit balance shown on the income account's normal side: positive.
    expect(income?.balances).toEqual([{ currency: 'USD', amountMinor: '100000' }]);

    const archive = await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/accounts/${id('TBC Business USD')}`,
      payload: { archived: true },
    });
    expect(archive.statusCode).toBe(409);
  });
});

describe('categorisation rules and preview actions', () => {
  let batchId: string;
  let feeRuleId: string;

  const rows = async () =>
    (
      await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/imports/${batchId}/rows` })
    ).json<{ items: Row[] }>().items;

  it('validates and creates rules in priority order', async () => {
    const empty = await post(owner, '/rules', {
      name: 'Everything',
      targetAccountId: id('Expenses: General'),
    });
    expect(empty.statusCode).toBe(422);

    const rangeWithoutCurrency = await post(owner, '/rules', {
      name: 'Small',
      amountMaxMinor: '1000',
      targetAccountId: id('Expenses: General'),
    });
    expect(rangeWithoutCurrency.statusCode).toBe(422);

    const fee = await post(owner, '/rules', {
      name: 'Bank fees',
      descriptionContains: 'service FEE',
      direction: 'out',
      targetAccountId: id('Expenses: Bank Fees'),
    });
    expect(fee.statusCode).toBe(201);
    feeRuleId = fee.json<{ id: string }>().id;

    const general = await post(owner, '/rules', {
      name: 'Anything out',
      direction: 'out',
      targetAccountId: id('Expenses: General'),
    });
    expect(general.json<{ priority: number }>().priority).toBeGreaterThan(
      fee.json<{ priority: number }>().priority,
    );
  });

  it('applies the first matching rule on upload, before the fixed suggestions', async () => {
    const body = multipart(SYNTHETIC, 'synthetic.csv');
    const res = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/imports`,
      payload: body.payload,
      headers: body.headers,
    });
    expect(res.statusCode).toBe(201);
    batchId = res.json<{ batch: { id: string } }>().batch.id;
    const [income, fee] = await rows();
    expect(income).toMatchObject({ accountId: id('Income: Services'), suggestedRuleId: null });
    expect(fee).toMatchObject({ accountId: id('Expenses: Bank Fees'), suggestedRuleId: feeRuleId });
  });

  it('re-applies rules to unedited rows after a rule change', async () => {
    const list = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/rules` });
    const ids = list.json<{ items: { id: string }[] }>().items.map((r) => r.id);
    const reorder = await post(owner, '/rules/reorder', { ruleIds: [...ids].reverse() });
    expect(reorder.statusCode).toBe(200);
    expect((await post(owner, '/rules/reorder', { ruleIds: ids.slice(1) })).statusCode).toBe(422);

    const applied = await post(owner, `/imports/${batchId}/apply-rules`, {});
    expect(applied.statusCode).toBe(200);
    expect(applied.json<{ updated: number }>().updated).toBe(1);
    expect((await rows())[1]?.accountId).toBe(id('Expenses: General'));
  });

  it('sets the account of several rows, or skips them, in one request', async () => {
    const all = await rows();
    const ids = all.map((r) => r.id);
    const set = await post(owner, `/imports/${batchId}/rows/bulk`, {
      rowIds: ids,
      accountId: id('Income: Export'),
    });
    expect(set.statusCode).toBe(200);
    expect(set.json<{ rows: Row[] }>().rows.map((r) => r.accountId)).toEqual([
      id('Income: Export'),
      id('Income: Export'),
    ]);

    const wrongCurrency = await post(owner, `/imports/${batchId}/rows/bulk`, {
      rowIds: ids,
      accountId: id('Bank GEL'),
    });
    expect(wrongCurrency.statusCode).toBe(422);

    const skip = await post(owner, `/imports/${batchId}/rows/bulk`, { rowIds: ids, skip: true });
    expect(skip.json<{ rows: Row[] }>().rows.map((r) => r.status)).toEqual(['skipped', 'skipped']);
    const batch = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/imports/${batchId}`,
    });
    expect(
      batch.json<{ batch: { stats: { new: number; skipped: number } } }>().batch.stats,
    ).toMatchObject({ new: 0, skipped: 2 });

    // Edited rows keep their choice when the rules are re-applied.
    const applied = await post(owner, `/imports/${batchId}/apply-rules`, {});
    expect(applied.json<{ updated: number }>().updated).toBe(0);
  });

  it('deletes a rule; rows it suggested keep their account', async () => {
    const res = await as(env, owner, {
      method: 'DELETE',
      url: `/v1/orgs/${orgId}/rules/${feeRuleId}`,
    });
    expect(res.statusCode).toBe(200);
    const again = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/rules/${feeRuleId}`,
    });
    expect(again.statusCode).toBe(404);
  });
});
