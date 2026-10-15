import type { Role } from '@ie-ledger/contracts';
import { getMembership } from '@ie-ledger/db';
import { fromNodeHeaders } from 'better-auth/node';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestAsyncHookHandler,
  RouteOptions,
} from 'fastify';
import { HttpProblem } from '../problem';

// Authentication and authorization for /v1 routes.
//
//   onRequest: requireAuth()            signed-in user (POST /v1/orgs, GET /v1/me, ...)
//   onRequest: requireRole('viewer')    member of :orgId with at least this role
//
// Guards run in onRequest, before the body is parsed or validated, so a non-member gets the
// same 404 whatever they send. Every `/v1/orgs/:orgId/*` route must declare requireRole; app
// start fails otherwise, and the cross-tenant harness (src/testing/tenancy.ts) checks them all.
//
// CSRF: the session is an httpOnly SameSite=Lax cookie. For unsafe methods carrying a cookie,
// the guards also require an `Origin` (or, failing that, `Referer`) from the trusted origins.
// Browsers always send Origin on cross-origin and on non-GET fetches, so a missing Origin on a
// cookie-bearing mutation is treated as hostile. GET/HEAD never mutate.

export const ROLE_RANK: Record<Role, number> = { viewer: 0, accountant: 1, owner: 2 };

/** Detail of the 404 a non-member gets; the harness asserts on it to tell it from other 404s. */
export const ORG_NOT_FOUND_DETAIL = 'Organization not found.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TENANT_ROUTE = /^\/v1\/orgs\/:orgId(\/|$)/;
const ORG_SCOPED_PREFIX = /^\/v1\/orgs\/:/;

type GuardKind = 'auth' | 'role';
const GUARD = Symbol('ie-ledger.guard');
type TaggedHook = onRequestAsyncHookHandler & { [GUARD]?: { kind: GuardKind; role?: Role } };

function tag(
  hook: onRequestAsyncHookHandler,
  kind: GuardKind,
  role?: Role,
): onRequestAsyncHookHandler {
  return Object.assign(hook, { [GUARD]: role === undefined ? { kind } : { kind, role } });
}

declare module 'fastify' {
  interface FastifyInstance {
    trustedOrigins: ReadonlySet<string>;
    /** Every route as registered, with its guard. Used by the cross-tenant harness. */
    routeTable: RegisteredRoute[];
  }
}

export interface RegisteredRoute {
  method: string;
  url: string;
  guard: { kind: GuardKind; role?: Role } | null;
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Throws 403 for a cookie-authenticated unsafe request that does not come from a trusted origin. */
export function assertSameOrigin(req: FastifyRequest) {
  if (!UNSAFE_METHODS.has(req.method) || !req.headers.cookie) return;
  const origin = originOf(req.headers.origin) ?? originOf(req.headers.referer);
  if (origin === null || !req.server.trustedOrigins.has(origin)) {
    throw new HttpProblem(403, 'forbidden', 'Cross-site request blocked.');
  }
}

async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  assertSameOrigin(req);
  if (!req.headers.cookie) {
    throw new HttpProblem(401, 'unauthenticated', 'Sign in first.');
  }
  const { headers, response } = await req.server.auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
    returnHeaders: true,
  });
  if (!response) throw new HttpProblem(401, 'unauthenticated', 'Sign in first.');
  // Better Auth may refresh the session (updateAge) and re-issue the cookie.
  const setCookie = headers.getSetCookie();
  if (setCookie.length > 0) reply.header('set-cookie', setCookie);
  req.ctx.session = response;
}

/** Requires a signed-in user. Use on `/v1` routes that are not org-scoped. */
export function requireAuth(): onRequestAsyncHookHandler {
  return tag(async function requireAuthHook(req, reply) {
    await authenticate(req, reply);
  }, 'auth');
}

/**
 * Requires membership of `:orgId` with at least `min` (viewer < accountant < owner).
 * Non-members get 404 so org ids cannot be probed; members below `min` get 403.
 */
export function requireRole(min: Role): onRequestAsyncHookHandler {
  return tag(
    async function requireRoleHook(req, reply) {
      await authenticate(req, reply);
      const orgId = (req.params as Record<string, string | undefined>).orgId;
      if (orgId === undefined) throw new Error('requireRole() on a route without :orgId');
      const membership = UUID.test(orgId)
        ? await getMembership(req.server.db, orgId, req.user.id)
        : null;
      if (!membership) throw new HttpProblem(404, 'not_found', ORG_NOT_FOUND_DETAIL);
      if (ROLE_RANK[membership.role] < ROLE_RANK[min]) {
        throw new HttpProblem(403, 'forbidden', `This needs the ${min} role or higher.`);
      }
      req.ctx.membership = { orgId, role: membership.role };
    },
    'role',
    min,
  );
}

function findGuard(hooks: RouteOptions['onRequest']): RegisteredRoute['guard'] {
  const list = (Array.isArray(hooks) ? hooks : hooks ? [hooks] : []) as TaggedHook[];
  for (const hook of list) {
    const guard = hook[GUARD];
    if (guard) return guard;
  }
  return null;
}

export function registerAuthz(app: FastifyInstance, opts: { trustedOrigins: string[] }) {
  app.decorate('trustedOrigins', new Set(opts.trustedOrigins));
  app.decorate('routeTable', [] as RegisteredRoute[]);

  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const guard = findGuard(route.onRequest);
    for (const method of methods) app.routeTable.push({ method, url: route.url, guard });

    if (ORG_SCOPED_PREFIX.test(route.url) && !TENANT_ROUTE.test(route.url)) {
      throw new Error(`${route.url}: name the org path parameter :orgId`);
    }
    if (TENANT_ROUTE.test(route.url) && guard?.kind !== 'role') {
      throw new Error(
        `${methods.join(',')} ${route.url}: tenant routes must declare onRequest: requireRole(...)`,
      );
    }
  });
}
