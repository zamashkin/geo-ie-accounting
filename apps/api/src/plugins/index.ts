import { createDb, type Db } from '@ie-ledger/db';
import type { FastifyInstance } from 'fastify';
import { createAuth, type AuthSettings } from '../auth/better-auth';
import { unconfiguredMailer, type Mailer } from '../auth/mailer';
import { betterAuthRoutes, meRoutes } from '../auth/routes';
import { memberRoutes } from '../routes/members/index';
import { orgRoutes } from '../routes/orgs/index';
import { registerAudit } from './audit';
import { registerAuthz } from './authz';
import { registerRequestContext } from './context';
import { registerMutations } from './mutations';

export { requireAuth, requireRole, ORG_NOT_FOUND_DETAIL, ROLE_RANK } from './authz';
export type { OrgMembership } from './context';

export interface PlatformOptions {
  webOrigin: string;
  auth: AuthSettings;
  /** Omitted by the OpenAPI script and unit tests: a pool that is never connected. */
  db?: Db | undefined;
  mailer?: Mailer | undefined;
}

/** Local-dev defaults so `buildApp` works without auth settings (OpenAPI script, unit tests). */
export const DEV_AUTH_SETTINGS: Omit<AuthSettings, 'trustedOrigins'> = {
  baseUrl: 'http://localhost:4000',
  secret: 'insecure-dev-secret-for-tests-and-openapi-only',
  secureCookies: false,
  rateLimit: false,
};

/**
 * Auth, tenancy and mutation plumbing (WS-05). Registers the hooks first (their onRoute hooks
 * must see every later route), then the auth, org and member routes. Feature routes registered
 * after this call get requireRole checks, `req.tx`, audit and idempotency automatically.
 */
export async function registerPlatform(app: FastifyInstance, opts: PlatformOptions) {
  let db = opts.db;
  if (!db) {
    const detached = createDb({ connectionString: 'postgres://detached@127.0.0.1:1/none', max: 1 });
    app.addHook('onClose', () => detached.close());
    db = detached.db;
  }
  const mailer = opts.mailer ?? unconfiguredMailer;
  const auth = createAuth({ ...opts.auth, db, mailer, log: app.log });

  registerRequestContext(app, { db, auth });
  registerAuthz(app, { trustedOrigins: opts.auth.trustedOrigins });
  registerAudit(app);
  registerMutations(app);

  await app.register(betterAuthRoutes, { baseUrl: opts.auth.baseUrl });
  await app.register(meRoutes);
  await app.register(orgRoutes);
  await app.register(memberRoutes, { webOrigin: opts.webOrigin, mailer });
}
