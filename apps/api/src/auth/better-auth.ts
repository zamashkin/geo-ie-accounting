import { schema, type Db } from '@geo-ie-accounting/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import type { FastifyBaseLogger } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { magicLinkMail, resetPasswordMail, verifyEmailMail } from './emails';
import type { Mailer } from './mailer';

/** Better Auth's endpoints live under the API's versioned base path. */
export const AUTH_BASE_PATH = '/v1/auth';

/** Session cookie name prefix: `geo-ie-accounting.session_token` (`__Secure-` prefixed over HTTPS). */
export const COOKIE_PREFIX = 'geo-ie-accounting';

export interface AuthSettings {
  /** Public URL of the API (Better Auth `baseURL`). */
  baseUrl: string;
  secret: string;
  /** Origins allowed to call auth endpoints with cookies and to be used as callback URLs. */
  trustedOrigins: string[];
  /** Force `Secure` cookies. True in production (HTTPS). */
  secureCookies: boolean;
  /** Parent domain to share the cookie between app.<domain> and api.<domain>. */
  cookieDomain?: string | undefined;
  /** Better Auth's own rate limiter (memory store). Off in tests. */
  rateLimit: boolean;
  /** False turns off sign-up by password and by magic link (`DEMO_SIGNUP=false`). Default on. */
  signUpEnabled?: boolean | undefined;
}

export interface CreateAuthOptions extends AuthSettings {
  db: Db;
  mailer: Mailer;
  log: FastifyBaseLogger;
}

const DAY = 24 * 60 * 60;

export function createAuth(opts: CreateAuthOptions) {
  const disableSignUp = opts.signUpEnabled === false;
  return betterAuth({
    appName: 'geo-ie-accounting',
    baseURL: opts.baseUrl,
    basePath: AUTH_BASE_PATH,
    secret: opts.secret,
    trustedOrigins: opts.trustedOrigins,
    database: drizzleAdapter(opts.db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    user: {
      additionalFields: {
        // users.read_only (ADR 0016). Not settable through sign-up or update-user.
        readOnly: { type: 'boolean', required: false, defaultValue: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp,
      // Financial data: an address must be proven before a password login works.
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await opts.mailer.send(resetPasswordMail(user.email, url));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await opts.mailer.send(verifyEmailMail(user.email, url));
      },
    },
    session: {
      expiresIn: 7 * DAY,
      updateAge: DAY,
    },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        storeToken: 'hashed',
        disableSignUp,
        sendMagicLink: async ({ email, url }) => {
          await opts.mailer.send(magicLinkMail(email, url));
        },
      }),
    ],
    rateLimit: { enabled: opts.rateLimit },
    advanced: {
      // Better Auth skips origin/callback-URL validation when NODE_ENV=test unless these are
      // set explicitly. Pin them so tests exercise exactly what production runs.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: opts.secureCookies,
      // Better Auth's defaults are already httpOnly + SameSite=Lax; stated here because the
      // CSRF defence of the /v1 API relies on them (see plugins/authz.ts).
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ...(opts.cookieDomain
        ? { crossSubDomainCookies: { enabled: true, domain: opts.cookieDomain } }
        : {}),
      database: { generateId: () => uuidv7() },
    },
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      log: (level, message) => {
        opts.log[level === 'debug' ? 'debug' : level]({ component: 'better-auth' }, message);
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
export type AuthUser = AuthSession['user'];
