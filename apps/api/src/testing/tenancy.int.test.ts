import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, signUp, startApiTestEnv, type ApiTestEnv } from './env';
import { checkTenantIsolation, concreteUrl, tenantRoutes } from './tenancy';

let env: ApiTestEnv;

beforeAll(async () => {
  env = await startApiTestEnv();
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

describe('cross-tenant harness', () => {
  it('finds the tenant routes from the Fastify route table', () => {
    const routes = tenantRoutes(env.app).map((r) => `${r.method} ${r.url}`);
    // WS-05's own routes; other workstreams' routes are picked up the same way.
    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /v1/orgs/:orgId',
        'GET /v1/orgs/:orgId/members',
        'GET /v1/orgs/:orgId/invitations',
        'POST /v1/orgs/:orgId/invitations',
        'POST /v1/orgs/:orgId/invitations/:invitationId/revoke',
        // MVP-A ledger routes.
        'PATCH /v1/orgs/:orgId',
        'GET /v1/orgs/:orgId/accounts',
        'POST /v1/orgs/:orgId/imports',
        'GET /v1/orgs/:orgId/imports',
        'GET /v1/orgs/:orgId/imports/:batchId',
        'GET /v1/orgs/:orgId/imports/:batchId/rows',
        'PATCH /v1/orgs/:orgId/imports/:batchId/rows/:rowId',
        'POST /v1/orgs/:orgId/imports/:batchId/commit',
        'GET /v1/orgs/:orgId/transactions',
        'GET /v1/orgs/:orgId/transactions/:transactionId',
        'POST /v1/orgs/:orgId/transactions/:transactionId/reverse',
        'GET /v1/orgs/:orgId/declarations',
        'GET /v1/orgs/:orgId/dashboard',
        // WS-08 declarations.
        'GET /v1/orgs/:orgId/declarations/:period',
        'POST /v1/orgs/:orgId/declarations/:period/file',
      ]),
    );
  });

  it('fills path params', () => {
    expect(concreteUrl('/v1/orgs/:orgId/x/:id', 'ORG')).toMatch(
      /^\/v1\/orgs\/ORG\/x\/[0-9a-f-]{36}$/,
    );
  });

  it('answers 404 to non-members, 401 to anonymous callers, on every tenant route', async () => {
    const owner = await signUp(env);
    const outsider = await signUp(env);
    await createOrg(env, outsider, 'Outsider IE'); // a member somewhere, just not here
    const orgId = await createOrg(env, owner, 'Victim IE');

    const result = await checkTenantIsolation(env, { orgId, outsider, member: owner });

    expect(result.routes.length).toBeGreaterThanOrEqual(5);
    expect(result.leaks).toEqual([]);
    expect(result.guardMissingForMember).toEqual([]);
    expect(result.anonymousAllowed).toEqual([]);
  });
});
