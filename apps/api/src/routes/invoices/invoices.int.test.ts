// Invoices against a real Postgres: gapless numbering under concurrency, the issued-invoice
// guard, the PDF, and matching an imported incoming payment. The statement is the hand-made
// synthetic BoG CSV (GBP 250.00 from "SAMPLE CUSTOMER LTD" on 4 June 2025; NBG from fixtures).
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

interface Invoice {
  id: string;
  status: string;
  number: string | null;
  totalMinor: string;
  paidMinor: string;
  outstandingMinor: string;
  issueDate: string | null;
  dueDate: string | null;
  lines: { quantity: string; lineTotalMinor: string }[];
  payments: { transactionId: string; amountMinor: string }[];
  parties: { seller: { name: string; address: string | null }; client: { name: string } };
}

let env: ApiTestEnv;
let owner: TestUser;
let orgId: string;
let clientId: string;

const call = (method: string, url: string, payload?: object) =>
  as(env, owner, {
    method: method,
    url: `/v1/orgs/${orgId}${url}`,
    ...(payload ? { payload } : {}),
  });

async function draft(lines = [{ description: 'Work', quantity: '1', unitPriceMinor: '10000' }]) {
  const res = await call('POST', '/invoices', { clientId, lines });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Invoice>();
}

beforeAll(async () => {
  env = await startApiTestEnv({ now: () => new Date('2026-10-17T09:00:00Z') });
  owner = await signUp(env);
  orgId = await createOrg(env, owner, 'ი/მ გიორგი ბერიძე');
  const profile = await as(env, owner, {
    method: 'PATCH',
    url: `/v1/orgs/${orgId}`,
    payload: { address: 'Rustaveli Ave 12, Tbilisi', invoiceDueDays: 10 },
  });
  expect(profile.statusCode, profile.body).toBe(200);
  const client = await call('POST', '/clients', {
    name: 'Sample Customer Ltd',
    country: 'gb',
    defaultCurrency: 'GBP',
    email: '',
  });
  expect(client.statusCode, client.body).toBe(201);
  expect(client.json()).toMatchObject({ country: 'GB', email: null, outstanding: [] });
  clientId = client.json<{ id: string }>().id;
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

describe('drafts and issue', () => {
  it('computes totals in domain and stores quantities as decimals', async () => {
    const inv = await draft([
      { description: 'Development', quantity: '2.5', unitPriceMinor: '4000' },
      { description: 'Review', quantity: '0.333', unitPriceMinor: '100' },
    ]);
    expect(inv).toMatchObject({
      status: 'draft',
      number: null,
      currency: 'GBP',
      totalMinor: '10033',
    });
    expect(inv.lines.map((l) => [l.quantity, l.lineTotalMinor])).toEqual([
      ['2.5', '10000'],
      ['0.333', '33'],
    ]);
    const bad = await call('POST', '/invoices', {
      clientId,
      lines: [{ description: 'x', quantity: '1.2345', unitPriceMinor: '1' }],
    });
    expect(bad.statusCode).toBe(400);
  });

  it('issues with the next number, default dates and frozen details; issued is immutable', async () => {
    const inv = await draft();
    const issued = await call('POST', `/invoices/${inv.id}/issue`, {});
    expect(issued.statusCode, issued.body).toBe(200);
    expect(issued.json()).toMatchObject({
      status: 'issued',
      number: '2026-001',
      issueDate: '2026-10-17',
      dueDate: '2026-10-27',
    });
    expect(issued.json<Invoice>().parties.seller.address).toBe('Rustaveli Ave 12, Tbilisi');

    expect((await call('PATCH', `/invoices/${inv.id}`, { notes: 'x' })).statusCode).toBe(409);
    expect((await call('POST', `/invoices/${inv.id}/issue`, {})).statusCode).toBe(409);
    expect((await call('DELETE', `/invoices/${inv.id}`)).statusCode).toBe(409);
    // The database refuses it too, whatever the route does.
    await expect(
      env.tdb.pool.query(`update invoices set total_minor = 1 where id = $1`, [inv.id]),
    ).rejects.toThrow(/cannot be edited/);

    // A later profile change does not reach the issued invoice.
    await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}`,
      payload: { address: 'Somewhere else' },
    });
    const again = await call('GET', `/invoices/${inv.id}`);
    expect(again.json<Invoice>().parties.seller.address).toBe('Rustaveli Ave 12, Tbilisi');
  });

  it('refuses to issue an empty or zero invoice, and never burns a number doing so', async () => {
    const empty = await draft([]);
    expect((await call('POST', `/invoices/${empty.id}/issue`, {})).statusCode).toBe(422);
    const zero = await draft([{ description: 'Free', quantity: '1', unitPriceMinor: '0' }]);
    expect((await call('POST', `/invoices/${zero.id}/issue`, {})).statusCode).toBe(422);
    const ok = await draft();
    const issued = await call('POST', `/invoices/${ok.id}/issue`, {});
    expect(issued.json<Invoice>().number).toBe('2026-002');
  });

  it('20 parallel issues get 20 distinct, consecutive numbers', async () => {
    const drafts = await Promise.all(Array.from({ length: 20 }, () => draft()));
    const results = await Promise.all(
      drafts.map((d) => call('POST', `/invoices/${d.id}/issue`, {})),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(20).fill(200));
    const seqs = results
      .map((r) => Number(r.json<Invoice>().number?.slice('2026-'.length)))
      .sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 3));
  });

  it('numbers by issue year and uses the org prefix from then on', async () => {
    await as(env, owner, {
      method: 'PATCH',
      url: `/v1/orgs/${orgId}`,
      payload: { invoicePrefix: 'INV-' },
    });
    const inv = await draft();
    const issued = await call('POST', `/invoices/${inv.id}/issue`, {
      issueDate: '2027-01-02',
      dueDate: '2027-01-31',
    });
    expect(issued.json<Invoice>().number).toBe('INV-2027-001');
  });

  it('voids an issued invoice keeping its number; duplicates into a new draft', async () => {
    const inv = await draft();
    const issued = (await call('POST', `/invoices/${inv.id}/issue`, {})).json<Invoice>();
    const voided = await call('POST', `/invoices/${inv.id}/void`, { reason: 'Wrong client' });
    expect(voided.json()).toMatchObject({ status: 'void', number: issued.number });
    expect((await call('POST', `/invoices/${inv.id}/void`, {})).statusCode).toBe(409);

    const copy = await call('POST', `/invoices/${inv.id}/duplicate`);
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ status: 'draft', number: null, totalMinor: '10000' });
  });

  it('renders the PDF', async () => {
    const inv = await draft();
    const res = await call('GET', `/invoices/${inv.id}/pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="draft-/);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('payment matching', () => {
  let invoiceId: string;
  let transactionId: string;

  beforeAll(async () => {
    const body = multipart(SYNTHETIC, 'synthetic.csv');
    const upload = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/imports`,
      payload: body.payload,
      headers: body.headers,
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const batchId = upload.json<{ batch: { id: string } }>().batch.id;
    const rows = (await call('GET', `/imports/${batchId}/rows`)).json<{
      items: { id: string; amountMinor: string }[];
    }>().items;
    const fee = rows.find((r) => r.amountMinor.startsWith('-'));
    await call('POST', `/imports/${batchId}/rows/bulk`, { rowIds: [fee?.id], skip: true });

    // An open invoice for GBP 250.00 issued before the payment: the import preview hints at it.
    const inv = await draft([{ description: 'Invoice 7', quantity: '1', unitPriceMinor: '25000' }]);
    invoiceId = inv.id;
    await call('POST', `/invoices/${invoiceId}/issue`, {
      issueDate: '2025-06-01',
      dueDate: '2025-06-15',
    });
    const hints = await call('GET', `/imports/${batchId}/invoice-hints`);
    expect(
      hints.json<{ items: { invoices: { invoiceId: string }[] }[] }>().items[0]?.invoices[0],
    ).toMatchObject({ invoiceId, amountMatch: 'exact' });

    const commit = await call('POST', `/imports/${batchId}/commit`, {});
    expect(commit.statusCode, commit.body).toBe(200);
    transactionId = commit.json<{ transactionIds: string[] }>().transactionIds[0] ?? '';
  });

  it('suggests the incoming payment by amount, currency and counterparty', async () => {
    const res = await call('GET', `/invoices/${invoiceId}/payment-suggestions`);
    const [best] = res.json<{ items: { transactionId: string; amountMatch: string }[] }>().items;
    expect(best).toMatchObject({ transactionId, amountMatch: 'exact' });
    const hints = await call('GET', `/transactions/${transactionId}/invoice-hints`);
    expect(hints.json()).toMatchObject({ allocations: [], suggestions: [{ invoiceId }] });
  });

  it('a partial match leaves it issued; the rest pays it; unmatching reopens it', async () => {
    const part = await call('POST', `/invoices/${invoiceId}/match-payment`, {
      transactionId,
      amountMinor: '10000',
    });
    expect(part.json()).toMatchObject({
      status: 'issued',
      paidMinor: '10000',
      outstandingMinor: '15000',
    });
    expect((await call('POST', `/invoices/${invoiceId}/void`, {})).statusCode).toBe(409);

    // The same bank line again: the composite key refuses a second row for the pair.
    const again = await call('POST', `/invoices/${invoiceId}/match-payment`, { transactionId });
    expect(again.statusCode).toBe(409);

    await call('DELETE', `/invoices/${invoiceId}/payments/${transactionId}`);
    const full = await call('POST', `/invoices/${invoiceId}/match-payment`, { transactionId });
    expect(full.json()).toMatchObject({
      status: 'paid',
      paidMinor: '25000',
      outstandingMinor: '0',
    });
    expect(
      (await call('GET', `/transactions/${transactionId}/invoice-hints`)).json(),
    ).toMatchObject({
      allocations: [{ invoiceId, status: 'paid', amountMinor: '25000' }],
      suggestions: [],
    });

    const reopened = await call('DELETE', `/invoices/${invoiceId}/payments/${transactionId}`);
    expect(reopened.json()).toMatchObject({ status: 'issued', paidMinor: '0' });
  });

  it('totals what clients owe per currency and lists overdue invoices', async () => {
    const summary = (await call('GET', '/invoices/summary')).json<{
      byCurrency: { currency: string; overdueCount: number }[];
      overdueCount: number;
    }>();
    expect(summary.byCurrency.map((c) => c.currency)).toEqual(['GBP']);
    expect(summary.overdueCount).toBeGreaterThanOrEqual(1);
    const overdue = await call('GET', '/invoices?status=overdue');
    expect(overdue.json<{ items: { id: string; overdue: boolean }[] }>().items).toContainEqual(
      expect.objectContaining({ id: invoiceId, overdue: true }),
    );
    const client = await call('GET', `/clients/${clientId}`);
    expect(client.json<{ overdueCount: number }>().overdueCount).toBeGreaterThanOrEqual(1);
  });
});
