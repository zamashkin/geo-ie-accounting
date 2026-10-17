// The MVP demo path end to end (docs/MVP.md): upload the BoG fixture, preview, commit, check
// the June 2025 figures, re-upload without duplicates, reverse. NBG answers from fixtures/nbg/.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { listAuditEntries } from '@geo-ie-accounting/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMemberViaInvite,
  as,
  createOrg,
  signUp,
  startApiTestEnv,
  type ApiTestEnv,
  type TestUser,
} from '../../testing/env';
import { multipart } from '../../testing/multipart';

const FIXTURES = new URL('../../../../../fixtures/statements/bog/', import.meta.url);
const XLSX = readFileSync(new URL('bog-gbp-2025-06.xlsx', FIXTURES));
const CSV = readFileSync(new URL('bog-gbp-2025-06.csv', FIXTURES));

interface Upload {
  batch: { id: string; status: string; stats: Record<string, number>; accountId: string };
  account: { id: string; name: string; iban: string; currency: string };
  accountMatch: string;
  detection: { parserId: string };
}
interface Row {
  id: string;
  rowIndex: number;
  status: string;
  operationType: string;
  amountMinor: string;
  accountId: string | null;
  transactionId: string | null;
}
interface Month {
  period: string;
  incomeGelMinor: string;
  ytdGelMinor: string;
  byPaymentMethod: Record<string, string>;
  rateBp: number;
  taxGelMinor: string;
  deadline: string;
}

let env: ApiTestEnv;
let owner: TestUser;
let orgId: string;

async function upload(user: TestUser, file: Buffer, name: string, org = orgId) {
  const body = multipart(file, name);
  return as(env, user, {
    method: 'POST',
    url: `/v1/orgs/${org}/imports`,
    payload: body.payload,
    headers: body.headers,
  });
}

async function rows(batchId: string, org = orgId) {
  const res = await as(env, owner, {
    method: 'GET',
    url: `/v1/orgs/${org}/imports/${batchId}/rows`,
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ items: Row[] }>().items;
}

const commit = (batchId: string, headers: Record<string, string> = {}, org = orgId) =>
  as(env, owner, {
    method: 'POST',
    url: `/v1/orgs/${org}/imports/${batchId}/commit`,
    headers,
  });

async function june(org = orgId) {
  const res = await as(env, owner, {
    method: 'GET',
    url: `/v1/orgs/${org}/declarations?year=2025`,
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ months: Month[] }>().months[5]!;
}

beforeAll(async () => {
  env = await startApiTestEnv({ now: () => new Date('2026-10-16T09:00:00Z') });
  owner = await signUp(env);
  orgId = await createOrg(env, owner, 'Demo path IE');
  const res = await as(env, owner, {
    method: 'PATCH',
    url: `/v1/orgs/${orgId}`,
    payload: { sbsEffectiveFrom: '2025-01-01' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ sbsEffectiveFrom: '2025-01-01', role: 'owner' });
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

describe('BoG GBP statement, June 2025', () => {
  let firstBatch: string;
  let incomeTx: string;

  it('uploads the XLSX: claims the GBP account and suggests a classification per row', async () => {
    const res = await upload(owner, XLSX, 'bog-gbp-2025-06.xlsx');
    expect(res.statusCode).toBe(201);
    const body = res.json<Upload>();
    expect(body).toMatchObject({
      accountMatch: 'claimed',
      detection: { parserId: 'bog-xlsx' },
      account: { iban: 'GE59BG0000000123456789', currency: 'GBP', name: 'Bank of Georgia GBP' },
      batch: { status: 'preview', stats: { total: 4, new: 4, duplicate: 0 } },
    });
    firstBatch = body.batch.id;

    const accounts = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/accounts` });
    const byId = new Map(
      accounts.json<{ items: { id: string; name: string }[] }>().items.map((a) => [a.id, a.name]),
    );
    const preview = await rows(firstBatch);
    expect(preview.map((r) => [r.operationType, r.status, byId.get(r.accountId ?? '')])).toEqual([
      ['incoming_payment', 'new', 'Income: Services'],
      ['fx_conversion', 'new', 'FX Clearing'],
      ['fx_conversion', 'new', 'FX Clearing'],
      ['incoming_payment', 'new', 'Income: Services'],
    ]);
  });

  it('pages through the preview rows', async () => {
    const page = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/imports/${firstBatch}/rows?limit=3`,
    });
    const first = page.json<{ items: Row[]; nextCursor: string }>();
    expect(first.items).toHaveLength(3);
    const next = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/imports/${firstBatch}/rows?limit=3&cursor=${first.nextCursor}`,
    });
    expect(next.json<{ items: Row[]; nextCursor: null }>()).toMatchObject({
      items: [{ rowIndex: 3 }],
      nextCursor: null,
    });
  });

  it('commits: one transaction per row, rates resolved from NBG, replayable with a key', async () => {
    const key = randomUUID();
    const res = await commit(firstBatch, { 'idempotency-key': key });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ batch: { status: string; stats: object }; transactionIds: string[] }>();
    expect(body.batch).toMatchObject({ status: 'committed', stats: { committed: 4 } });
    expect(body.transactionIds).toHaveLength(4);
    // The bank's GEL equivalents agree with ours (FORMAT.md: the bank uses the NBG rate).
    expect(res.json<{ warnings: unknown[] }>().warnings).toEqual([]);
    expect(env.nbgCalls.map((u) => u.searchParams.get('date')).sort()).toEqual([
      '2025-06-04',
      '2025-06-05',
      '2025-06-11',
    ]);
    [incomeTx] = body.transactionIds as [string];

    const replay = await commit(firstBatch, { 'idempotency-key': key });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(body);

    const again = await commit(firstBatch);
    expect(again.statusCode).toBe(409);

    const audit = await listAuditEntries(env.tdb.db, orgId, { entity: 'transaction' });
    expect(audit).toHaveLength(4);
  });

  it('declares June 2025: income 5,698.66 on line 20 at 1%, tax 56.99, due 15 July', async () => {
    expect(await june()).toMatchObject({
      period: '2025-06',
      incomeGelMinor: '569866',
      ytdGelMinor: '569866',
      byPaymentMethod: { cash_register: '0', pos: '0', bank: '569866', other: '0' },
      rateBp: 100,
      taxGelMinor: '5699',
      deadline: '2025-07-15',
    });
    const res = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/declarations?year=2025`,
    });
    expect(res.json()).toMatchObject({
      year: 2025,
      totalIncomeGelMinor: '569866',
      totalTaxGelMinor: '5699',
      limitStatus: 'ok',
      annualLimitGelMinor: '50000000',
      sbsEffectiveFrom: '2025-01-01',
    });
  });

  it('lists the transactions with the original amount, GEL equivalent and NBG rate', async () => {
    const res = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/transactions` });
    expect(res.statusCode).toBe(200);
    const items = res.json<{
      items: {
        occurredOn: string;
        source: string;
        paymentMethod: string | null;
        postings: {
          amountMinor: string;
          currency: string;
          gelAmountMinor: string;
          account: { name: string };
          rate: { rate: string; validFrom: string } | null;
        }[];
      }[];
    }>().items;
    expect(
      items.map((t) => {
        const bank = t.postings[0]!;
        return [
          t.occurredOn,
          bank.amountMinor,
          bank.gelAmountMinor,
          bank.rate?.rate,
          t.paymentMethod,
        ];
      }),
    ).toEqual([
      ['2025-06-11', '36400', '134163', '3.6858', 'bank'],
      ['2025-06-05', '-48900', '-180676', '3.6948', null],
      ['2025-06-05', '-69085', '-255255', '3.6948', null],
      ['2025-06-04', '118000', '435703', '3.6924', 'bank'],
    ]);
    expect(items[0]!.postings[0]!.rate?.validFrom).toBe('2025-06-11');
    expect(items[1]!.postings[1]!.account.name).toBe('FX Clearing');

    const filtered = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/transactions?from=2025-06-05&to=2025-06-05&limit=1`,
    });
    const page = filtered.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
  });

  it('re-uploading the same XLSX, or the CSV export of it, finds only duplicates', async () => {
    for (const [file, name] of [
      [XLSX, 'bog-gbp-2025-06.xlsx'],
      [CSV, 'bog-gbp-2025-06.csv'],
    ] as const) {
      const res = await upload(owner, file, name);
      expect(res.statusCode).toBe(201);
      const body = res.json<Upload>();
      expect(body.accountMatch).toBe('matched');
      expect(body.batch.stats).toMatchObject({ total: 4, new: 0, duplicate: 4 });
      const preview = await rows(body.batch.id);
      expect(preview.every((r) => r.status === 'duplicate' && r.transactionId !== null)).toBe(true);
      const committed = await commit(body.batch.id);
      expect(committed.json<{ transactionIds: string[] }>().transactionIds).toEqual([]);
    }
    const list = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/transactions` });
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(4);
  });

  it('shows the dashboard for 2025', async () => {
    const res = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/dashboard?year=2025`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      year: 2025,
      ytdIncomeGelMinor: '569866',
      annualLimitUsedBp: 113,
      limitStatus: 'ok',
      latestMonth: { period: '2025-06', taxGelMinor: '5699', deadline: '2025-07-15' },
      // Every 2025 deadline is before "today" (2026-10-16).
      nextDeadline: null,
    });
    const current = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/dashboard?year=2026`,
    });
    expect(current.json()).toMatchObject({
      year: 2026,
      latestYearWithData: 2025,
      latestMonth: null,
      nextDeadline: { period: '2026-10', deadline: '2026-11-15', zeroReturn: true },
    });
  });

  it('opens the dashboard and declarations on the latest year with data by default', async () => {
    for (const path of ['dashboard', 'declarations']) {
      const res = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/${path}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ year: 2025, latestYearWithData: 2025 });
    }
    // No transactions yet: the current year in Tbilisi (the clock says 2026-10-16).
    const empty = await createOrg(env, owner, 'Empty IE');
    for (const path of ['dashboard', 'declarations']) {
      const res = await as(env, owner, { method: 'GET', url: `/v1/orgs/${empty}/${path}` });
      expect(res.json()).toMatchObject({ year: 2026, latestYearWithData: null });
    }
  });

  it('a reversal takes the income back out, and only once', async () => {
    const res = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/transactions/${incomeTx}/reverse`,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const reversal = res.json<{ id: string; reversesId: string; source: string }>();
    expect(reversal).toMatchObject({ reversesId: incomeTx, source: 'reversal' });
    expect(await june()).toMatchObject({ incomeGelMinor: '134163', taxGelMinor: '1342' });

    const detail = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/transactions/${incomeTx}`,
    });
    expect(detail.json()).toMatchObject({ reversedById: reversal.id });

    const twice = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/transactions/${incomeTx}/reverse`,
      payload: {},
    });
    expect(twice.statusCode).toBe(409);
    const ofReversal = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/transactions/${reversal.id}/reverse`,
      payload: {},
    });
    expect(ofReversal.statusCode).toBe(409);
  });
});

describe('preview edits', () => {
  it('skipping a row keeps it out of the ledger; choosing an account books against it', async () => {
    const orgB = await createOrg(env, owner, 'Edits IE');
    const res = await upload(owner, CSV, 'statement.csv', orgB);
    expect(res.statusCode).toBe(201);
    const batchId = res.json<Upload>().batch.id;
    const [first, second] = await rows(batchId, orgB);

    const accounts = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgB}/accounts` });
    const interest = accounts
      .json<{ items: { id: string; name: string }[] }>()
      .items.find((a) => a.name === 'Income: Interest')!;

    const skip = await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgB}/imports/${batchId}/rows/${second!.id}`,
      payload: { skip: true },
    });
    expect(skip.json()).toMatchObject({ status: 'skipped' });
    const choose = await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgB}/imports/${batchId}/rows/${first!.id}`,
      payload: { accountId: interest.id },
    });
    expect(choose.json()).toMatchObject({ status: 'new', accountId: interest.id });

    const bad = await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgB}/imports/${batchId}/rows/${first!.id}`,
      payload: { accountId: res.json<Upload>().account.id },
    });
    expect(bad.statusCode).toBe(422);

    const committed = await commit(batchId, {}, orgB);
    expect(committed.json<{ transactionIds: string[] }>().transactionIds).toHaveLength(3);
    // No SBS start date yet: the 11.06 SBS income is excluded and flagged, nothing declared.
    expect(await june(orgB)).toMatchObject({ incomeGelMinor: '0', excludedGelMinor: '134163' });
    await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgB}`,
      payload: { sbsEffectiveFrom: '2025-01-01' },
    });
    // The first payment went to non-SBS interest income: only the 11.06 payment is declared.
    expect(await june(orgB)).toMatchObject({ incomeGelMinor: '134163', excludedGelMinor: '0' });

    const late = await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgB}/imports/${batchId}/rows/${second!.id}`,
      payload: { skip: false },
    });
    expect(late.statusCode).toBe(409);
  });
});

describe('upload validation and roles', () => {
  it('rejects a file that is not a statement, a non-multipart body and an oversized file', async () => {
    const junk = await upload(owner, Buffer.from('hello,world\n1,2\n'), 'notes.txt');
    expect(junk.statusCode).toBe(422);
    const json = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/imports`,
      payload: {},
    });
    expect(json.statusCode).toBe(415);
    const big = await upload(owner, Buffer.alloc(5 * 1024 * 1024 + 1, 0x41), 'big.csv');
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ code: 'payload_too_large' });
  });

  it('lets a viewer read but not import, and only the owner change the SBS start', async () => {
    const viewer = await signUp(env);
    await addMemberViaInvite(env, orgId, owner, viewer, 'viewer');
    expect((await upload(viewer, XLSX, 'x.xlsx')).statusCode).toBe(403);
    const read = await as(env, viewer, { method: 'GET', url: `/v1/orgs/${orgId}/imports` });
    expect(read.statusCode).toBe(200);
    expect(read.json<{ items: unknown[] }>().items.length).toBeGreaterThanOrEqual(3);
    const patch = await as(env, viewer, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}`,
      payload: { sbsEffectiveFrom: null },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('excludes income before the SBS start date', async () => {
    const res = await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}`,
      payload: { sbsEffectiveFrom: '2025-06-10' },
    });
    expect(res.statusCode).toBe(200);
    const audit = await listAuditEntries(env.tdb.db, orgId, { entity: 'organization' });
    expect(audit[0]).toMatchObject({ action: 'update' });
    // 04.06 income was reversed already; 11.06 (1,341.63) is after the start.
    expect(await june()).toMatchObject({ incomeGelMinor: '134163', taxGelMinor: '1342' });
  });
});
