// Filing a return, drift after a reversal, corrections, and the dashboard aggregates, on the
// BoG GBP fixture (June 2025: income 5,698.66 GEL). NBG answers from fixtures/nbg/.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { listAuditEntries, schema } from '@geo-ie-accounting/db';
import { eq } from 'drizzle-orm';
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

const XLSX = readFileSync(
  new URL('../../../../../fixtures/statements/bog/bog-gbp-2025-06.xlsx', import.meta.url),
);

interface Filing {
  id: string;
  version: number;
  supersedesId: string | null;
  figures: { incomeGelMinor: string; ytdGelMinor: string; taxGelMinor: string; rateBp: number };
  transactionIds: string[];
  rsReference: string | null;
  filedBy: { id: string };
}
interface Period {
  month: {
    period: string;
    status: { kind: string; differences: { line: string; filed: string; live: string }[] };
    latestFiling: { id: string; version: number } | null;
  };
  transactions: { id: string; incomeGelMinor: string; counterparty: string | null }[];
  filings: Filing[];
  transactionChanges: { added: string[]; removed: string[] } | null;
  fileBlocker: string | null;
}

let env: ApiTestEnv;
let owner: TestUser;
let orgId: string;
let incomeTx: string;

const period = async (p = '2025-06') => {
  const res = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/declarations/${p}` });
  expect(res.statusCode).toBe(200);
  return res.json<Period>();
};

const file = (body: object, headers: Record<string, string> = {}, p = '2025-06', user = owner) =>
  as(env, user, {
    method: 'POST',
    url: `/v1/orgs/${orgId}/declarations/${p}/file`,
    payload: body,
    headers,
  });

beforeAll(async () => {
  env = await startApiTestEnv({ now: () => new Date('2026-10-16T09:00:00Z') });
  owner = await signUp(env);
  orgId = await createOrg(env, owner, 'Filing IE');
  await as(env, owner, {
    method: 'PATCH',
    url: `/v1/orgs/${orgId}`,
    payload: { sbsEffectiveFrom: '2025-01-01' },
  });
  const body = multipart(XLSX, 'bog-gbp-2025-06.xlsx');
  const up = await as(env, owner, {
    method: 'POST',
    url: `/v1/orgs/${orgId}/imports`,
    payload: body.payload,
    headers: body.headers,
  });
  const batchId = up.json<{ batch: { id: string } }>().batch.id;
  const commit = await as(env, owner, {
    method: 'POST',
    url: `/v1/orgs/${orgId}/imports/${batchId}/commit`,
  });
  [incomeTx] = commit.json<{ transactionIds: string[] }>().transactionIds as [string];
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

describe('declaration period and filing', () => {
  it('shows an overdue June with its two contributing transactions', async () => {
    const p = await period();
    expect(p.month.status.kind).toBe('overdue');
    expect(p.fileBlocker).toBeNull();
    expect(p.transactions.map((t) => t.incomeGelMinor)).toEqual(['435703', '134163']);
    expect(p.filings).toEqual([]);
    expect(p.transactionChanges).toBeNull();
  });

  it('files June: snapshot, audit row, replayable with the same key', async () => {
    const key = randomUUID();
    const res = await file({ rsReference: ' RS-123 ' }, { 'idempotency-key': key });
    expect(res.statusCode).toBe(201);
    const filing = res.json<Filing>();
    expect(filing).toMatchObject({
      version: 1,
      supersedesId: null,
      rsReference: 'RS-123',
      figures: {
        incomeGelMinor: '569866',
        ytdGelMinor: '569866',
        taxGelMinor: '5699',
        rateBp: 100,
      },
      filedBy: { id: owner.id },
    });
    expect(filing.transactionIds).toHaveLength(2);

    const replay = await file({ rsReference: ' RS-123 ' }, { 'idempotency-key': key });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(filing);

    expect(await listAuditEntries(env.tdb.db, orgId, { entity: 'declaration_filing' })).toEqual([
      expect.objectContaining({ action: 'file', entityId: filing.id }),
    ]);
    expect((await period()).month.status.kind).toBe('filed');
  });

  it('refuses a second original, an open month and a month without status', async () => {
    expect((await file({})).statusCode).toBe(409);
    expect((await file({}, {}, '2026-10')).statusCode).toBe(409);
    expect((await file({}, {}, '2024-06')).statusCode).toBe(409);
  });

  it('a viewer cannot file', async () => {
    const viewer = await signUp(env);
    await addMemberViaInvite(env, orgId, owner, viewer, 'viewer');
    expect((await file({}, {}, '2025-06', viewer)).statusCode).toBe(403);
  });

  it('a reversal shows drift and leaves the snapshot alone', async () => {
    const res = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/transactions/${incomeTx}/reverse`,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const reversalId = res.json<{ id: string }>().id;

    const p = await period();
    expect(p.month.status.kind).toBe('filed_with_drift');
    expect(p.month.status.differences).toEqual(
      expect.arrayContaining([
        { line: 'income', filed: '569866', live: '134163', delta: '-435703' },
        { line: 'tax', filed: '5699', live: '1342', delta: '-4357' },
      ]),
    );
    expect(p.transactionChanges).toEqual({ added: [reversalId], removed: [] });
    expect(p.filings[0]!.figures.incomeGelMinor).toBe('569866');

    const year = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/declarations?year=2025`,
    });
    const months = year.json<{ months: Period['month'][] }>().months;
    expect(months[5]!.status.kind).toBe('filed_with_drift');
    expect(months[4]!.status.kind).toBe('overdue');
  });

  it('files a correction linked to the previous filing; the database refuses edits', async () => {
    const before = await period();
    const first = before.filings[0]!;
    expect((await file({ supersedesId: randomUUID() })).statusCode).toBe(409);
    const res = await file({ supersedesId: first.id });
    expect(res.statusCode).toBe(201);
    expect(res.json<Filing>()).toMatchObject({
      version: 2,
      supersedesId: first.id,
      figures: { incomeGelMinor: '134163' },
    });
    const after = await period();
    expect(after.month.status.kind).toBe('filed');
    expect(after.filings.map((f) => f.version)).toEqual([2, 1]);
    expect(after.filings[1]!.figures.incomeGelMinor).toBe('569866');

    await expect(
      env.tdb.db
        .update(schema.declarationFilings)
        .set({ taxGelMinor: 0n })
        .where(eq(schema.declarationFilings.id, first.id)),
    ).rejects.toMatchObject({ cause: { code: '23001' } });
  });
});

describe('dashboard', () => {
  it('aggregates counterparties, currencies and the return needing attention', async () => {
    const res = await as(env, owner, {
      method: 'GET',
      url: `/v1/orgs/${orgId}/dashboard?year=2025`,
    });
    expect(res.statusCode).toBe(200);
    const d = res.json<{
      byCounterparty: { top: { incomeGelMinor: string }[]; other: { incomeGelMinor: string } };
      currencyMix: { currency: string; amountMinor: string; incomeGelMinor: string }[];
      nextReturn: { period: string; status: { kind: string } } | null;
      statusCounts: Record<string, number>;
    }>();
    const topTotal = d.byCounterparty.top.reduce((s, c) => s + BigInt(c.incomeGelMinor), 0n);
    expect(topTotal + BigInt(d.byCounterparty.other.incomeGelMinor)).toBe(134_163n);
    expect(d.currencyMix).toEqual([
      { currency: 'GBP', amountMinor: '36400', incomeGelMinor: '134163', transactionCount: 3 },
    ]);
    expect(d.nextReturn).toMatchObject({ period: '2025-01', status: { kind: 'overdue' } });
    expect(d.statusCounts).toMatchObject({ filed: 1, overdue: 11 });
  });
});
