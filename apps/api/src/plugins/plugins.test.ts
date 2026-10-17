import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';
import { requireRole } from './authz';
import { problemFromDbError } from './db-errors';
import { canonicalJson, requestHash } from './mutations';

let app: App | undefined;

async function makeApp() {
  app = await buildApp(
    { version: 'test', webOrigin: 'http://localhost:3000', logger: false },
    { checkDatabase: () => Promise.resolve(true) },
  );
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('route registration', () => {
  it('refuses a tenant route without requireRole', async () => {
    const a = await makeApp();
    expect(() => a.get('/v1/orgs/:orgId/unguarded', () => ({}))).toThrow(
      /tenant routes must declare onRequest: requireRole/,
    );
  });

  it('refuses an org-scoped route whose param is not :orgId', async () => {
    const a = await makeApp();
    expect(() =>
      a.get('/v1/orgs/:id/things', { onRequest: requireRole('viewer') }, () => ({})),
    ).toThrow(/:orgId/);
  });

  it('records guarded routes in the route table', async () => {
    const a = await makeApp();
    a.get('/v1/orgs/:orgId/things', { onRequest: requireRole('accountant') }, () => ({}));
    expect(a.routeTable).toContainEqual({
      method: 'GET',
      url: '/v1/orgs/:orgId/things',
      guard: { kind: 'role', role: 'accountant' },
    });
  });
});

describe('guards without a session', () => {
  it('answers 401 before touching the database', async () => {
    const a = await makeApp();
    const res = await a.inject({
      method: 'GET',
      url: '/v1/orgs/01900000-0000-7000-8000-000000000002',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'unauthenticated' });
  });

  it('blocks a cookie-carrying mutation from a foreign origin', async () => {
    const a = await makeApp();
    for (const origin of ['https://evil.example', undefined]) {
      const res = await a.inject({
        method: 'POST',
        url: '/v1/orgs',
        headers: { cookie: 'geo-ie-accounting.session_token=x', ...(origin ? { origin } : {}) },
        payload: { name: 'X' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'forbidden',
        detail: 'Cross-site request blocked.',
      });
    }
  });

  it('rejects a malformed Idempotency-Key', async () => {
    const a = await makeApp();
    a.post('/v1/test-echo', { config: { audit: false } }, () => ({ ok: true }));
    const res = await a.inject({
      method: 'POST',
      url: '/v1/test-echo',
      headers: { 'idempotency-key': 'has space' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('request hash', () => {
  it('ignores key order but not values, method or url', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: null }] })).toBe('{"a":[{"c":null,"d":2}],"b":1}');
    const h = requestHash('POST', '/v1/orgs', { a: 1, b: 2 });
    expect(requestHash('POST', '/v1/orgs', { b: 2, a: 1 })).toBe(h);
    expect(requestHash('POST', '/v1/orgs', { a: 1, b: 3 })).not.toBe(h);
    expect(requestHash('PUT', '/v1/orgs', { a: 1, b: 2 })).not.toBe(h);
    expect(requestHash('POST', '/v1/orgs?x=1', { a: 1, b: 2 })).not.toBe(h);
  });
});

describe('database errors', () => {
  const pgError = (code: string, constraint?: string) =>
    Object.assign(new Error('Failed query'), {
      cause: Object.assign(new Error('pg'), { code, constraint }),
    });

  it('maps by SQLSTATE and constraint name', () => {
    expect(problemFromDbError(pgError('23514', 'transaction_balanced'))).toEqual({
      status: 422,
      code: 'validation_failed',
      detail: 'Postings must sum to zero in every currency.',
    });
    expect(problemFromDbError(pgError('23001', 'ledger_immutable'))).toMatchObject({
      status: 409,
      code: 'conflict',
    });
    expect(problemFromDbError(pgError('23505', 'something_uq'))).toMatchObject({ status: 409 });
    expect(problemFromDbError(pgError('23503'))).toMatchObject({ status: 422 });
    expect(problemFromDbError(pgError('XX000'))).toBeNull();
    expect(problemFromDbError(new Error('not a db error'))).toBeNull();
  });
});
