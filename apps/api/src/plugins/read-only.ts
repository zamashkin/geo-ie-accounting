import { PublicConfig } from '@geo-ie-accounting/contracts';
import { isReadOnlyEmail } from '@geo-ie-accounting/db';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AuthUser } from '../auth/better-auth';
import { DEMO_LOGIN } from '../demo/profile';
import { HttpProblem, problemResponse } from '../problem';

// Read-only logins (ADR 0016). `users.read_only` marks the public demo login: it can sign in
// and out and read everything its memberships allow, and every change is refused with
// 403 `demo_read_only`, whatever its role. Three places enforce it:
//
//   1. `/v1` routes: the auth guards call `assertMayAct` once the session is known
//      (plugins/authz.ts), so every guarded POST/PUT/PATCH/DELETE is covered.
//   2. Better Auth (`/v1/auth/*`): `guardAuthRequest` lets a read-only login sign in and out
//      and refuses every other POST (password, email, profile, sessions), signed in or not.
//   3. `DEMO_MODE=false`: read-only logins cannot sign in at all, and their sessions stop working.

export interface DemoSettings {
  /** `DEMO_MODE`: offer the demo login on the sign-in page and let it sign in. */
  enabled: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    demo: DemoSettings;
  }
}

export const READ_ONLY_DETAIL = 'This is a read-only demo: changes are disabled.';
const DEMO_OFF_DETAIL = 'The demo is switched off.';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Better Auth endpoints a read-only login may POST to. */
const READ_ONLY_AUTH_PATHS = new Set(['/sign-in/email', '/sign-out']);

const readOnly = (user: AuthUser) => user.readOnly === true;

/** Called by the auth guards with the signed-in user, before the route runs. */
export function assertMayAct(req: FastifyRequest, user: AuthUser) {
  if (!readOnly(user)) return;
  if (!req.server.demo.enabled) throw new HttpProblem(401, 'unauthenticated', DEMO_OFF_DETAIL);
  if (UNSAFE_METHODS.has(req.method)) {
    throw new HttpProblem(403, 'demo_read_only', READ_ONLY_DETAIL);
  }
}

function emailOf(body: unknown): string | null {
  if (typeof body !== 'string' || body.length === 0) return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && 'email' in parsed) {
      return typeof parsed.email === 'string' ? parsed.email : null;
    }
  } catch {
    // Not JSON: Better Auth answers it itself.
  }
  return null;
}

/**
 * Runs before a POST is handed to Better Auth. `path` is relative to the auth base path
 * (`/sign-in/email`). Throws 403 for anything a read-only login may not do.
 */
export async function guardAuthRequest(req: FastifyRequest, path: string) {
  if (req.method !== 'POST' || path === '/sign-out') return;
  if (!READ_ONLY_AUTH_PATHS.has(path) && req.headers.cookie) {
    const session = await req.server.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (session && readOnly(session.user)) {
      throw new HttpProblem(403, 'demo_read_only', READ_ONLY_DETAIL);
    }
  }
  // Signed out but naming the demo address: password reset, magic link, verification mail.
  const email = emailOf(req.body);
  if (email === null || !(await isReadOnlyEmail(req.server.db, email))) return;
  if (path === '/sign-in/email') {
    if (!req.server.demo.enabled) throw new HttpProblem(403, 'forbidden', DEMO_OFF_DETAIL);
    return;
  }
  throw new HttpProblem(403, 'demo_read_only', READ_ONLY_DETAIL);
}

export function registerReadOnly(app: FastifyInstance, demo: DemoSettings) {
  app.decorate('demo', demo);
}

/** `GET /v1/public-config`: the demo login (when on) and whether sign-up is open. */
export const publicConfigRoutes: FastifyPluginAsyncZod<{ signUpEnabled: boolean }> = async (
  app,
  opts,
) => {
  app.get(
    '/v1/public-config',
    {
      schema: {
        operationId: 'getPublicConfig',
        tags: ['auth'],
        summary: 'Settings the sign-in and sign-up pages need: demo login, sign-up open',
        response: { 200: PublicConfig, default: problemResponse },
      },
    },
    () => ({
      demo: app.demo.enabled ? { email: DEMO_LOGIN.email, password: DEMO_LOGIN.password } : null,
      signUpEnabled: opts.signUpEnabled,
    }),
  );
};
