// POST /imports/:batchId/commit beyond the demo path: the error paths (422 unassigned row,
// 409 already committed, 503 NBG unavailable) and the bank-GEL cross-check. Uses a hand-made statement (no real data) with one incoming payment whose printed GEL
// equivalent is 5 tetri off the NBG conversion, and one bank fee that gets no suggestion.
import { readFileSync } from 'node:fs';
import { listAuditEntries } from '@ie-ledger/db';
import { createNbgClient } from '@ie-ledger/nbg';
import { createFixtureFetch } from '@ie-ledger/nbg/testing';
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

interface Problem {
  status: number;
  code: string;
  detail?: string;
  errors?: { path: string; message: string }[];
}

let env: ApiTestEnv;
let owner: TestUser;
/** While true, every NBG request fails (the 503 path). Otherwise NBG answers from fixtures. */
let nbgDown = false;

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

const commit = (orgId: string, batchId: string, headers: Record<string, string> = {}) =>
  as(env, owner, {
    method: 'POST',
    url: `/v1/orgs/${orgId}/imports/${batchId}/commit`,
    headers,
  });

async function batchStatus(orgId: string, batchId: string): Promise<string> {
  const res = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/imports/${batchId}` });
  return res.json<{ batch: { status: string } }>().batch.status;
}

async function transactionCount(orgId: string): Promise<number> {
  const res = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/transactions` });
  return res.json<{ items: unknown[] }>().items.length;
}

async function accountId(orgId: string, name: string): Promise<string> {
  const res = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/accounts` });
  const account = res
    .json<{ items: { id: string; name: string }[] }>()
    .items.find((a) => a.name === name);
  if (!account) throw new Error(`no account ${name}`);
  return account.id;
}

beforeAll(async () => {
  const nbg = createNbgClient({ fetch: createFixtureFetch().fetch, retries: 0 });
  env = await startApiTestEnv({
    now: () => new Date('2026-10-16T09:00:00Z'),
    rates: {
      getRates: (date, currencies) =>
        nbgDown ? Promise.reject(new Error('NBG is down')) : nbg.getRates(date, currencies),
    },
  });
  owner = await signUp(env);
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

// Runs first: the rates for June 2025 are not in the database yet, so commit has to ask NBG.
describe('NBG unavailable', () => {
  it('answers 503 rate_unavailable, books nothing, and works once NBG is back', async () => {
    const orgId = await createOrg(env, owner, 'NBG down IE');
    const { batchId, rows } = await uploadSynthetic(orgId);
    const fees = await accountId(orgId, 'Expenses: Bank Fees');
    await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/imports/${batchId}/rows/${rows[1]!.id}`,
      payload: { accountId: fees },
    });

    nbgDown = true;
    try {
      const res = await commit(orgId, batchId);
      expect(res.statusCode).toBe(503);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json<Problem>()).toMatchObject({
        status: 503,
        code: 'rate_unavailable',
        detail: 'The NBG rate for GBP on 2025-06-04 is not available. Try again later.',
      });
    } finally {
      nbgDown = false;
    }
    expect(await batchStatus(orgId, batchId)).toBe('preview');
    expect(await transactionCount(orgId)).toBe(0);
    expect(await listAuditEntries(env.tdb.db, orgId, { entity: 'transaction' })).toEqual([]);

    const retry = await commit(orgId, batchId);
    expect(retry.statusCode).toBe(200);
    expect(retry.json<{ transactionIds: string[] }>().transactionIds).toHaveLength(2);
  });
});

describe('unassigned rows and repeated commits', () => {
  it('answers 422 naming the row without an account, and books nothing', async () => {
    const orgId = await createOrg(env, owner, 'Unassigned IE');
    const { batchId, rows } = await uploadSynthetic(orgId);
    const [income, fee] = rows as [Row, Row];
    expect(income).toMatchObject({ operationType: 'incoming_payment' });
    expect(income.accountId).not.toBeNull();
    expect(fee).toMatchObject({ operationType: 'other', accountId: null });

    const res = await commit(orgId, batchId);
    expect(res.statusCode).toBe(422);
    expect(res.json<Problem>()).toMatchObject({
      status: 422,
      code: 'validation_failed',
      errors: [{ path: `rows/${fee.id}`, message: 'No account chosen' }],
    });
    expect(await batchStatus(orgId, batchId)).toBe('preview');
    expect(await transactionCount(orgId)).toBe(0);

    // Skipping the row unblocks the commit; only the income is booked.
    await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/imports/${batchId}/rows/${fee.id}`,
      payload: { skip: true },
    });
    const ok = await commit(orgId, batchId);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ transactionIds: string[] }>().transactionIds).toHaveLength(1);
  });

  it('answers 409 when the batch is already committed, unless it is a replay', async () => {
    const orgId = await createOrg(env, owner, 'Committed IE');
    const { batchId, rows } = await uploadSynthetic(orgId);
    await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/imports/${batchId}/rows/${rows[1]!.id}`,
      payload: { skip: true },
    });
    const first = await commit(orgId, batchId, { 'idempotency-key': 'commit-once' });
    expect(first.statusCode).toBe(200);

    const replay = await commit(orgId, batchId, { 'idempotency-key': 'commit-once' });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    const again = await commit(orgId, batchId, { 'idempotency-key': 'commit-twice' });
    expect(again.statusCode).toBe(409);
    expect(again.json<Problem>()).toMatchObject({
      status: 409,
      code: 'conflict',
      detail: 'This import is already committed.',
    });
    expect(await transactionCount(orgId)).toBe(1);
  });
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
    expect(tx.json<{ postings: { gelAmountMinor: string }[] }>().postings[0]?.gelAmountMinor).toBe(
      '92310',
    );
  });
});
