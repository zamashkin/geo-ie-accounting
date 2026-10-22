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
        // Account and member management.
        'PATCH /v1/orgs/:orgId/members/:userId',
        'DELETE /v1/orgs/:orgId/members/:userId',
        'POST /v1/orgs/:orgId/invitations/:invitationId/resend',
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
        // Accounts management, manual transactions, rules and preview actions.
        'GET /v1/orgs/:orgId/accounts/balances',
        'POST /v1/orgs/:orgId/accounts',
        'PATCH /v1/orgs/:orgId/accounts/:accountId',
        'POST /v1/orgs/:orgId/transactions',
        'POST /v1/orgs/:orgId/transactions/preview',
        'GET /v1/orgs/:orgId/rules',
        'GET /v1/orgs/:orgId/rules/:ruleId',
        'POST /v1/orgs/:orgId/rules',
        'PATCH /v1/orgs/:orgId/rules/:ruleId',
        'DELETE /v1/orgs/:orgId/rules/:ruleId',
        'POST /v1/orgs/:orgId/rules/reorder',
        'POST /v1/orgs/:orgId/imports/:batchId/rows/bulk',
        'POST /v1/orgs/:orgId/imports/:batchId/apply-rules',
        // WS-08 declarations.
        'GET /v1/orgs/:orgId/declarations/:period',
        'POST /v1/orgs/:orgId/declarations/:period/file',
        // WS-09 clients and invoices.
        'GET /v1/orgs/:orgId/clients',
        'POST /v1/orgs/:orgId/clients',
        'GET /v1/orgs/:orgId/clients/:clientId',
        'PATCH /v1/orgs/:orgId/clients/:clientId',
        'GET /v1/orgs/:orgId/invoices',
        'POST /v1/orgs/:orgId/invoices',
        'GET /v1/orgs/:orgId/invoices/summary',
        'GET /v1/orgs/:orgId/invoices/:invoiceId',
        'PATCH /v1/orgs/:orgId/invoices/:invoiceId',
        'DELETE /v1/orgs/:orgId/invoices/:invoiceId',
        'POST /v1/orgs/:orgId/invoices/:invoiceId/issue',
        'POST /v1/orgs/:orgId/invoices/:invoiceId/void',
        'POST /v1/orgs/:orgId/invoices/:invoiceId/duplicate',
        'GET /v1/orgs/:orgId/invoices/:invoiceId/pdf',
        'GET /v1/orgs/:orgId/invoices/:invoiceId/payment-suggestions',
        'POST /v1/orgs/:orgId/invoices/:invoiceId/match-payment',
        'DELETE /v1/orgs/:orgId/invoices/:invoiceId/payments/:transactionId',
        'GET /v1/orgs/:orgId/transactions/:transactionId/invoice-hints',
        'GET /v1/orgs/:orgId/imports/:batchId/invoice-hints',
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
