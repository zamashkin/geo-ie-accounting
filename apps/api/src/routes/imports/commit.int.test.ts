// POST /imports/:batchId/commit beyond the demo path: the bank-GEL cross-check and the error
// paths. Uses a hand-made statement (no real data) with one incoming payment whose printed GEL
// equivalent is 5 tetri off the NBG conversion, and one bank fee that gets no suggestion.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createOrg,
  signUp,
  startApiTestEnv,
  type ApiTestEnv,
  type TestUser,
} from '../../testing/env';
import { multipart } from '../../testing/multipart';

const SYNTHETIC = readFileSync(
  new URL(
    '../../../../../fixtures/statements/bog/synthetic-gbp-2025-06-unassigned.csv',
    import.meta.url,
  ),
);

interface Row {
  id: string;
  operationType: string;
  accountId: string | null;
}

let env: ApiTestEnv;
let owner: TestUser;

async function uploadSynthetic(orgId: string): Promise<{ batchId: string; rows: Row[] }> {
  const body = multipart(SYNTHETIC, 'synthetic.csv');
  const res = await as(env, owner, {
    method: 'POST',
    url: `/v1/orgs/${orgId}/imports`,
    payload: body.payload,
    headers: body.headers,
  });
  expect(res.statusCode).toBe(201);
  const batchId = res.json<{ batch: { id: string } }>().batch.id;
  const rows = await as(env, owner, {
    method: 'GET',
    url: `/v1/orgs/${orgId}/imports/${batchId}/rows`,
  });
  return { batchId, rows: rows.json<{ items: Row[] }>().items };
}

const commit = (orgId: string, batchId: string) =>
  as(env, owner, { method: 'POST', url: `/v1/orgs/${orgId}/imports/${batchId}/commit` });

async function accountId(orgId: string, name: string): Promise<string> {
  const res = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/accounts` });
  const account = res
    .json<{ items: { id: string; name: string }[] }>()
    .items.find((a) => a.name === name);
  if (!account) throw new Error(`no account ${name}`);
  return account.id;
}

beforeAll(async () => {
  env = await startApiTestEnv({ now: () => new Date('2026-10-16T09:00:00Z') });
  owner = await signUp(env);
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

describe('bank GEL cross-check', () => {
  it('books our NBG figure and warns when the bank’s GEL differs by more than 1 tetri', async () => {
    const orgId = await createOrg(env, owner, 'GEL check IE');
    const { batchId, rows } = await uploadSynthetic(orgId);
    const [income, fee] = rows as [Row, Row];
    // The fee has no suggestion; book it against bank fees so the commit can go through.
    const fees = await accountId(orgId, 'Expenses: Bank Fees');
    const patched = await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/imports/${batchId}/rows/${fee.id}`,
      payload: { accountId: fees },
    });
    expect(patched.statusCode).toBe(200);

    const res = await commit(orgId, batchId);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ transactionIds: string[]; warnings: unknown[] }>();
    expect(body.transactionIds).toHaveLength(2);
    // GBP 250.00 × 3.6924 = GEL 923.10; the statement says 923.15. The fee (2.50 × 3.6858 =
    // 9.2145 → 9.21) matches, so it is not listed.
    expect(body.warnings).toEqual([
      {
        code: 'bank_gel_mismatch',
        rowId: income.id,
        transactionId: body.transactionIds[0],
        bookedOn: '2025-06-04',
        amountMinor: '25000',
        currency: 'GBP',
        gelAmountMinor: '92310',
        bankGelAmountMinor: '92315',
        message: expect.any(String) as string,
      },
    ]);

    const tx = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/transactions/${body.transactionIds[0]}`,
    });
    expect(
      tx.json<{ postings: { gelAmountMinor: string }[] }>().postings[0]?.gelAmountMinor,
    ).toBe('92310');
  });
});
