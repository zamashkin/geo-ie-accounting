import { Money, PaginationQuery, Problem } from '@ie-ledger/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, type App } from './app';
import { HttpProblem } from './problem';

let app: App | undefined;

async function makeApp(dbOk = true) {
  app = await buildApp(
    { version: 'test', webOrigin: 'http://localhost:3000', logger: false },
    { checkDatabase: () => Promise.resolve(dbOk) },
  );
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /healthz', () => {
  it('reports ok when the database answers', async () => {
    const res = await (await makeApp(true)).inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', version: 'test', checks: { database: 'ok' } });
  });

  it('returns 503 degraded when the database is down', async () => {
    const res = await (await makeApp(false)).inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', checks: { database: 'fail' } });
  });
});

describe('request id', () => {
  it('echoes a safe x-request-id', async () => {
    const res = await (
      await makeApp()
    ).inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('replaces an unsafe x-request-id with a UUID', async () => {
    const res = await (
      await makeApp()
    ).inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'bad id\nwith newline' },
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('problem+json', () => {
  it('answers unknown routes with a 404 problem', async () => {
    const res = await (await makeApp()).inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const problem = Problem.parse(res.json());
    expect(problem.code).toBe('not_found');
    expect(problem.requestId).toBe(res.headers['x-request-id']);
  });

  it('turns schema validation failures into validation_failed', async () => {
    const a = await makeApp();
    a.get('/test/page', { schema: { querystring: PaginationQuery } }, (req) => ({
      limit: req.query.limit,
    }));
    const res = await a.inject({ method: 'GET', url: '/test/page?limit=5000' });
    expect(res.statusCode).toBe(400);
    const problem = Problem.parse(res.json());
    expect(problem.code).toBe('validation_failed');
    expect(problem.errors?.[0]?.path).toContain('limit');
  });

  it('maps HttpProblem and hides internal errors', async () => {
    const a = await makeApp();
    a.get('/test/conflict', () => {
      throw new HttpProblem(409, 'conflict', 'Already filed');
    });
    a.get('/test/boom', () => {
      throw new Error('secret internals');
    });
    const conflict = await a.inject({ method: 'GET', url: '/test/conflict' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'conflict', detail: 'Already filed' });
    const boom = await a.inject({ method: 'GET', url: '/test/boom' });
    expect(boom.statusCode).toBe(500);
    expect(boom.body).not.toContain('secret');
  });
});

describe('money on the wire', () => {
  it('serialises bigint minor units as strings and parses them back', async () => {
    const a = await makeApp();
    a.post(
      '/test/money',
      {
        schema: {
          body: z.object({ money: Money }),
          response: { 200: z.object({ doubled: Money }) },
        },
      },
      (req) => {
        expect(typeof req.body.money.amountMinor).toBe('bigint');
        return {
          doubled: {
            amountMinor: req.body.money.amountMinor * 2n,
            currency: req.body.money.currency,
          },
        };
      },
    );
    const res = await a.inject({
      method: 'POST',
      url: '/test/money',
      payload: { money: { amountMinor: '9007199254740993', currency: 'USD' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"doubled":{"amountMinor":"18014398509481986","currency":"USD"}}');
  });

  it('rejects numeric money in requests', async () => {
    const a = await makeApp();
    a.post('/test/money', { schema: { body: Money } }, () => ({}));
    const res = await a.inject({
      method: 'POST',
      url: '/test/money',
      payload: { amountMinor: 100, currency: 'USD' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('OpenAPI', () => {
  it('documents /healthz and describes money as a string', async () => {
    const a = await makeApp();
    a.get('/test/money', { schema: { response: { 200: Money } } }, () => ({
      amountMinor: 1n,
      currency: 'GEL',
    }));
    await a.ready();
    const spec = a.swagger() as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/healthz']).toBeDefined();
    expect(JSON.stringify(spec.paths['/test/money'])).toContain('"amountMinor":{"type":"string"');
  });
});
