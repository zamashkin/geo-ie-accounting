import { ListRatesResponse, Problem, type JobPayload } from '@geo-ie-accounting/contracts';
import type { ExchangeRateRow, ListRatesOptions } from '@geo-ie-accounting/db';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app';
import { encodeRatesCursor, QueueUnavailableError, type RatesRouteDeps } from './index';

const TOKEN = 'a'.repeat(40);
let app: App | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const row = (validFrom: string, currency: string, rate: string): ExchangeRateRow => ({
  id: '0199e8a0-0000-7000-8000-000000000001',
  currency,
  validFrom,
  rate,
  quantity: 1,
  source: 'nbg',
  setAt: new Date('2026-10-09T13:01:01.779Z'),
  fetchedAt: new Date('2026-10-15T14:00:00.000Z'),
  createdAt: new Date('2026-10-15T14:00:00.000Z'),
});

function fakeDeps(overrides: Partial<RatesRouteDeps> = {}) {
  const listCalls: ListRatesOptions[] = [];
  const enqueued: JobPayload<'rates.backfill'>[] = [];
  const deps: RatesRouteDeps = {
    listRates: (opts) => {
      listCalls.push(opts);
      return Promise.resolve({
        items: [row('2026-10-10', 'USD', '2.600500')],
        next: { validFrom: '2026-10-10', currency: 'USD' },
      });
    },
    enqueueBackfill: (payload) => {
      enqueued.push(payload);
      return Promise.resolve('job-1');
    },
    adminToken: TOKEN,
    ...overrides,
  };
  return { deps, listCalls, enqueued };
}

async function makeApp(rates?: RatesRouteDeps) {
  app = await buildApp(
    { version: 'test', webOrigin: 'http://localhost:3000', logger: false },
    { checkDatabase: () => Promise.resolve(true), ...(rates ? { rates } : {}) },
  );
  return app;
}

describe('GET /v1/rates', () => {
  it('lists rates as decimal strings with a cursor to the next page', async () => {
    const f = fakeDeps();
    const res = await (
      await makeApp(f.deps)
    ).inject({ url: '/v1/rates?currency=USD&from=2026-10-01&to=2026-10-15&limit=1' });
    expect(res.statusCode).toBe(200);
    const body = ListRatesResponse.parse(res.json());
    expect(body.items[0]).toEqual({
      id: '0199e8a0-0000-7000-8000-000000000001',
      currency: 'USD',
      validFrom: '2026-10-10',
      rate: '2.600500',
      quantity: 1,
      source: 'nbg',
      setAt: '2026-10-09T13:01:01.779Z',
      fetchedAt: '2026-10-15T14:00:00.000Z',
    });
    expect(body.nextCursor).toBe(encodeRatesCursor({ validFrom: '2026-10-10', currency: 'USD' }));
    expect(f.listCalls[0]).toEqual({
      currency: 'USD',
      from: '2026-10-01',
      to: '2026-10-15',
      limit: 1,
      after: undefined,
    });
  });

  it('passes a decoded cursor back to the repository', async () => {
    const f = fakeDeps();
    const cursor = encodeRatesCursor({ validFrom: '2026-10-10', currency: 'EUR' });
    await (await makeApp(f.deps)).inject({ url: `/v1/rates?cursor=${cursor}` });
    expect(f.listCalls[0]?.after).toEqual({ validFrom: '2026-10-10', currency: 'EUR' });
  });

  it.each([
    ['a malformed cursor', '/v1/rates?cursor=not-a-cursor'],
    ['a reversed range', '/v1/rates?from=2026-10-15&to=2026-10-01'],
    ['a lowercase currency', '/v1/rates?currency=usd'],
  ])('rejects %s with validation_failed', async (_label, url) => {
    const res = await (await makeApp(fakeDeps().deps)).inject({ url });
    expect(res.statusCode).toBe(400);
    expect(Problem.parse(res.json()).code).toBe('validation_failed');
  });

  it('answers 503 when the app has no rates deps', async () => {
    const res = await (await makeApp()).inject({ url: '/v1/rates' });
    expect(res.statusCode).toBe(503);
  });
});

describe('POST /v1/rates/backfill', () => {
  const body = { from: '2025-06-01', to: '2025-06-30', currencies: ['GBP'] };
  const post = (a: App, headers: Record<string, string> = {}, payload: object = body) =>
    a.inject({ method: 'POST', url: '/v1/rates/backfill', headers, payload });

  it('queues the job for an admin and answers 202', async () => {
    const f = fakeDeps();
    const res = await post(await makeApp(f.deps), {
      'x-admin-token': TOKEN,
      'x-request-id': 'req-42',
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ jobId: 'job-1', status: 'queued' });
    expect(f.enqueued).toEqual([{ ...body, meta: { requestId: 'req-42' } }]);
  });

  it('answers 401 without the admin token', async () => {
    const f = fakeDeps();
    const res = await post(await makeApp(f.deps));
    expect(res.statusCode).toBe(401);
    expect(Problem.parse(res.json()).code).toBe('unauthenticated');
    expect(f.enqueued).toHaveLength(0);
  });

  it('answers 403 with a wrong token', async () => {
    const f = fakeDeps();
    const res = await post(await makeApp(f.deps), { 'x-admin-token': 'b'.repeat(40) });
    expect(res.statusCode).toBe(403);
    expect(f.enqueued).toHaveLength(0);
  });

  it('answers 403 when no admin token is configured', async () => {
    const f = fakeDeps({ adminToken: undefined });
    const res = await post(await makeApp(f.deps), { 'x-admin-token': TOKEN });
    expect(res.statusCode).toBe(403);
  });

  it('validates the body once the token is accepted', async () => {
    const res = await post(
      await makeApp(fakeDeps().deps),
      { 'x-admin-token': TOKEN },
      { ...body, from: '2025-07-01' },
    );
    expect(res.statusCode).toBe(400);
    expect(Problem.parse(res.json()).code).toBe('validation_failed');
  });

  it('checks the token before validating the body', async () => {
    const res = await post(await makeApp(fakeDeps().deps), {}, { nonsense: true });
    expect(res.statusCode).toBe(401);
  });

  it('answers 503 when the queue is down', async () => {
    const f = fakeDeps({
      enqueueBackfill: () => Promise.reject(new QueueUnavailableError(new Error('ECONNREFUSED'))),
    });
    const res = await post(await makeApp(f.deps), { 'x-admin-token': TOKEN });
    expect(res.statusCode).toBe(503);
    expect(Problem.parse(res.json()).code).toBe('service_unavailable');
  });
});

describe('OpenAPI', () => {
  it('documents both rates routes', async () => {
    const a = await makeApp();
    await a.ready();
    const spec = a.swagger() as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths['/v1/rates']?.get).toBeDefined();
    expect(spec.paths['/v1/rates/backfill']?.post).toBeDefined();
  });
});
