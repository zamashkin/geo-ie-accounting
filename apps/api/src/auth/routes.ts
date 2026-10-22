import {
  AccountSession,
  AccountSessionList,
  MeResponse,
  MutationHeaders,
  SessionParams,
} from '@geo-ie-accounting/contracts';
import {
  deleteUserSession,
  listActiveSessions,
  listOrganizationsForUser,
  type SessionRow,
} from '@geo-ie-accounting/db';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuth } from '../plugins/authz';
import { guardAuthRequest } from '../plugins/read-only';
import { HttpProblem, problemResponse } from '../problem';
import { AUTH_BASE_PATH } from './better-auth';

// Response headers not copied from Better Auth's Response: Fastify sets its own framing.
const SKIP_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'set-cookie',
]);

/**
 * Mounts Better Auth's handler at /v1/auth/*. Bodies are passed through untouched (this plugin
 * has its own string content-type parser), cookies are forwarded with every Set-Cookie kept.
 * Better Auth answers in its own JSON error format (`{ code, message }`), not problem+json.
 */
export const betterAuthRoutes: FastifyPluginAsync<{ baseUrl: string }> = async (app, opts) => {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    schema: { hide: true },
    // URLs carry single-use tokens (magic link, email verification): keep them out of info logs.
    logLevel: 'warn',
    handler: async (req, reply) => {
      const url = new URL(req.url, opts.baseUrl);
      await guardAuthRequest(req, url.pathname.slice(AUTH_BASE_PATH.length));
      const init: RequestInit = { method: req.method, headers: fromNodeHeaders(req.headers) };
      if (req.method === 'POST' && typeof req.body === 'string') init.body = req.body;
      const response = await app.auth.handler(new Request(url, init));
      reply.status(response.status);
      response.headers.forEach((value, name) => {
        if (!SKIP_HEADERS.has(name)) reply.header(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      const text = await response.text();
      return reply.send(text.length > 0 ? text : undefined);
    },
  });
};

/** `GET /v1/me`: the signed-in user and their memberships, for the web shell. */
export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/v1/me',
    {
      onRequest: requireAuth(),
      schema: {
        operationId: 'getMe',
        tags: ['auth'],
        summary: 'Signed-in user and the organizations they belong to',
        response: { 200: MeResponse, default: problemResponse },
      },
    },
    async (req) => {
      const user = req.user;
      const orgs = await listOrganizationsForUser(app.db, user.id, { limit: 500 });
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          readOnly: user.readOnly === true,
          createdAt: user.createdAt.toISOString(),
        },
        memberships: orgs.map((o) => ({ orgId: o.id, orgName: o.name, role: o.role })),
      };
    },
  );
};

const toSessionDto = (row: SessionRow, currentId: string): AccountSession => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  userAgent: row.userAgent,
  ipAddress: row.ipAddress,
  current: row.id === currentId,
});

/**
 * The signed-in user's sessions, for the account page. Better Auth's own `list-sessions`
 * returns every session's token to the browser (and needs a session younger than a day), so
 * these routes list and revoke by id instead. They are not org-scoped, so no audit row
 * (audit_log is per org); `Idempotency-Key` works as on every `/v1` mutation.
 */
export const accountSessionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/v1/me/sessions',
    {
      onRequest: requireAuth(),
      schema: {
        operationId: 'listMySessions',
        tags: ['auth'],
        summary: 'Active sessions of the signed-in user',
        response: { 200: AccountSessionList, default: problemResponse },
      },
    },
    async (req) => {
      const rows = await listActiveSessions(app.db, req.user.id);
      const currentId = req.ctx.session?.session.id ?? '';
      return { items: rows.map((r) => toSessionDto(r, currentId)) };
    },
  );

  app.post(
    '/v1/me/sessions/:sessionId/revoke',
    {
      onRequest: requireAuth(),
      schema: {
        operationId: 'revokeMySession',
        tags: ['auth'],
        summary: 'Sign out one of your other sessions',
        description: 'The current session cannot be revoked here: sign out instead.',
        params: SessionParams,
        headers: MutationHeaders,
        response: { 200: AccountSession, default: problemResponse },
      },
    },
    async (req) => {
      if (req.params.sessionId === req.ctx.session?.session.id) {
        throw new HttpProblem(
          409,
          'conflict',
          'This is the session you are using. Sign out instead.',
        );
      }
      const revoked = await deleteUserSession(req.tx, req.user.id, req.params.sessionId);
      if (!revoked) throw new HttpProblem(404, 'not_found', 'Session not found.');
      return toSessionDto(revoked, '');
    },
  );
};
