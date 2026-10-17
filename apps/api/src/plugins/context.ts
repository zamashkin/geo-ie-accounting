import type { Role } from '@geo-ie-accounting/contracts';
import type { Db, Tx } from '@geo-ie-accounting/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Auth, AuthSession, AuthUser } from '../auth/better-auth';
import { HttpProblem } from '../problem';

/** The caller's membership in the org named by `:orgId`. */
export interface OrgMembership {
  orgId: string;
  role: Role;
}

/** Per-request state filled by the authz and mutation hooks. Read it through the getters below. */
export interface RequestContext {
  session: AuthSession | null;
  membership: OrgMembership | null;
  tx: Tx | null;
  auditCount: number;
  requestHash: string | null;
  idempotencyKey: string | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    auth: Auth;
  }
  interface FastifyRequest {
    ctx: RequestContext;
    /** The signed-in user. Throws 401 when the route has no auth guard and nobody is signed in. */
    readonly user: AuthUser;
    /** Membership resolved by `requireRole`. Only on `/v1/orgs/:orgId/*` routes. */
    readonly membership: OrgMembership;
    /** The request's DB transaction. Only inside mutating `/v1` handlers (plugins/mutations.ts). */
    readonly tx: Tx;
  }
  interface FastifyContextConfig {
    /** `false` opts a mutating `/v1` route out of the transaction + idempotency wrapper. */
    tx?: boolean;
    /** `false` lets a mutating tenant route finish without an audit row. Use sparingly. */
    audit?: boolean;
  }
}

export function registerRequestContext(app: FastifyInstance, deps: { db: Db; auth: Auth }) {
  app.decorate('db', deps.db);
  app.decorate('auth', deps.auth);

  app.decorateRequest('ctx', null as unknown as RequestContext);
  app.addHook('onRequest', async (req) => {
    req.ctx = {
      session: null,
      membership: null,
      tx: null,
      auditCount: 0,
      requestHash: null,
      idempotencyKey: null,
    };
  });

  app.decorateRequest('user', {
    getter(this: FastifyRequest) {
      const session = this.ctx.session;
      if (!session) throw new HttpProblem(401, 'unauthenticated', 'Sign in first.');
      return session.user;
    },
  });
  app.decorateRequest('membership', {
    getter(this: FastifyRequest) {
      const membership = this.ctx.membership;
      if (!membership) throw new Error('req.membership read on a route without requireRole()');
      return membership;
    },
  });
  app.decorateRequest('tx', {
    getter(this: FastifyRequest) {
      const tx = this.ctx.tx;
      if (!tx) throw new Error('req.tx read outside a mutating /v1 handler');
      return tx;
    },
  });
}
