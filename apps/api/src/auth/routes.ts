import { MeResponse } from '@geo-ie-accounting/contracts';
import { listOrganizationsForUser } from '@geo-ie-accounting/db';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuth } from '../plugins/authz';
import { guardAuthRequest } from '../plugins/read-only';
import { problemResponse } from '../problem';
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
