// Cross-tenant harness (CLAUDE.md: every /v1/orgs/:orgId/* route is covered).
//
// Routes come from the app's own route table (filled by an onRoute hook in plugins/authz.ts),
// so any route another workstream registers in buildApp is tested without touching this file.
// For each tenant route it sends a request for an org the caller is NOT a member of and
// expects the tenant guard's 404. A positive control (a member of that org) makes sure the
// 404 really comes from the guard, not from a missing resource.
import { uuidv7 } from 'uuidv7';
import type { App } from '../app';
import { ORG_NOT_FOUND_DETAIL } from '../plugins/authz';
import { as, type ApiTestEnv, type TestUser } from './env';

export interface TenantRoute {
  method: string;
  url: string;
}

const TENANT_ROUTE = /^\/v1\/orgs\/:orgId(\/|$)/;

/** Every `/v1/orgs/:orgId/*` route registered on the app, except Fastify's implicit HEAD. */
export function tenantRoutes(app: App): TenantRoute[] {
  const seen = new Set<string>();
  return app.routeTable
    .filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS' && TENANT_ROUTE.test(r.url))
    .map(({ method, url }) => ({ method, url }))
    .filter((r) => {
      const id = `${r.method} ${r.url}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

/** Fills `:orgId` with the target org and every other param (and `*`) with a fresh UUID. */
export function concreteUrl(url: string, orgId: string): string {
  return url
    .replace(':orgId', orgId)
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, () => uuidv7())
    .replace(/\*$/, uuidv7());
}

export interface TenantProbe {
  route: TenantRoute;
  status: number;
  detail: string | undefined;
}

async function probe(env: ApiTestEnv, user: TestUser | null, route: TenantRoute, orgId: string) {
  const res = await as(env, user, {
    method: route.method,
    url: concreteUrl(route.url, orgId),
    ...(route.method === 'GET' || route.method === 'DELETE' ? {} : { payload: {} }),
  });
  let detail: string | undefined;
  try {
    detail = res.json<{ detail?: string }>().detail;
  } catch {
    detail = undefined;
  }
  return { route, status: res.statusCode, detail };
}

/**
 * Probes every tenant route of org `orgId` as `outsider` (no membership), `member` (a member of
 * `orgId`, positive control) and anonymously. Returns the routes that broke isolation.
 */
export async function checkTenantIsolation(
  env: ApiTestEnv,
  opts: { orgId: string; outsider: TestUser; member: TestUser },
) {
  const routes = tenantRoutes(env.app);
  const leaks: TenantProbe[] = [];
  const guardMissingForMember: TenantProbe[] = [];
  const anonymousAllowed: TenantProbe[] = [];
  for (const route of routes) {
    const outsider = await probe(env, opts.outsider, route, opts.orgId);
    if (outsider.status !== 404 || outsider.detail !== ORG_NOT_FOUND_DETAIL) leaks.push(outsider);

    const member = await probe(env, opts.member, route, opts.orgId);
    if (member.detail === ORG_NOT_FOUND_DETAIL) guardMissingForMember.push(member);

    const anonymous = await probe(env, null, route, opts.orgId);
    if (anonymous.status !== 401) anonymousAllowed.push(anonymous);
  }
  return { routes, leaks, guardMissingForMember, anonymousAllowed };
}
