// Test support for API integration tests (`*.int.test.ts`): a real Postgres (see
// packages/db/src/testing), the full app, an in-memory mail outbox and session helpers.
import { startTestDatabase, type TestDatabase } from '@ie-ledger/db/testing';
import { createNbgClient } from '@ie-ledger/nbg';
import { createFixtureFetch } from '@ie-ledger/nbg/testing';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { buildApp, type App } from '../app';
import type { Mailer, MailMessage } from '../auth/mailer';

export const WEB_ORIGIN = 'http://localhost:3000';
export const API_URL = 'http://localhost:4000';
export const PASSWORD = 'correct-horse-battery-staple';

export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];
  send(message: MailMessage) {
    this.outbox.push(message);
    return Promise.resolve();
  }
  /** The last link sent to `to`, as a path+query to inject into the app. */
  lastLink(to: string, match: RegExp = /https?:\/\/\S+/): string {
    const mail = this.outbox.findLast((m) => m.to === to);
    const url = mail?.text.match(match)?.[0];
    if (!url) throw new Error(`no link mailed to ${to}`);
    return url;
  }
}

export interface ApiTestEnv {
  tdb: TestDatabase;
  app: App;
  mailer: MemoryMailer;
  /** NBG requests the app made (answered from fixtures). */
  nbgCalls: URL[];
  close: () => Promise<void>;
}

export async function startApiTestEnv(opts: { now?: () => Date } = {}): Promise<ApiTestEnv> {
  const tdb = await startTestDatabase();
  const mailer = new MemoryMailer();
  // NBG is answered from fixtures/nbg/; a request without a recorded fixture fails the test.
  const nbgFetch = createFixtureFetch();
  const app = await buildApp(
    {
      version: 'test',
      webOrigin: WEB_ORIGIN,
      logger: false,
      auth: { baseUrl: API_URL, rateLimit: false },
    },
    {
      checkDatabase: () => Promise.resolve(true),
      db: tdb.db,
      mailer,
      ledger: {
        rates: createNbgClient({ fetch: nbgFetch.fetch, retries: 0 }),
        now: opts.now ?? (() => new Date()),
      },
    },
  );
  return {
    tdb,
    app,
    mailer,
    nbgCalls: nbgFetch.calls,
    close: async () => {
      await app.close();
      await tdb.close();
    },
  };
}

/** `name=value; ...` from Set-Cookie headers, for the next request's Cookie header. */
export function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

export const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

/** Signs up with email+password, follows the verification link and returns the session. */
export async function signUp(
  env: ApiTestEnv,
  email = `${uuidv7()}@example.test`,
): Promise<TestUser> {
  const res = await env.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-up/email',
    headers: { origin: WEB_ORIGIN },
    payload: { email, password: PASSWORD, name: 'Test User', callbackURL: `${WEB_ORIGIN}/` },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const verify = await env.app.inject({ method: 'GET', url: pathOf(env.mailer.lastLink(email)) });
  const cookie = cookieFrom(verify);
  if (!cookie.includes('session_token')) {
    throw new Error(`verification did not sign in: ${verify.statusCode} ${verify.body}`);
  }
  const me = await env.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
  const { user } = me.json<{ user: { id: string } }>();
  return { id: user.id, email, cookie };
}

/** Browser-like request as `user`: session cookie plus the web app's Origin. */
export function as(
  env: ApiTestEnv,
  user: TestUser | null,
  opts: InjectOptions & { url: string },
): Promise<LightMyRequestResponse> {
  return env.app.inject({
    ...opts,
    headers: {
      origin: WEB_ORIGIN,
      ...(user ? { cookie: user.cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
}

export async function createOrg(
  env: ApiTestEnv,
  owner: TestUser,
  name = 'Test IE',
): Promise<string> {
  const res = await as(env, owner, { method: 'POST', url: '/v1/orgs', payload: { name } });
  if (res.statusCode !== 201) throw new Error(`create org failed: ${res.statusCode} ${res.body}`);
  return res.json<{ id: string }>().id;
}

/** Invites `user` to the org with `role` and accepts as them. */
export async function addMemberViaInvite(
  env: ApiTestEnv,
  orgId: string,
  owner: TestUser,
  user: TestUser,
  role: 'owner' | 'accountant' | 'viewer',
) {
  const invite = await as(env, owner, {
    method: 'POST',
    url: `/v1/orgs/${orgId}/invitations`,
    payload: { email: user.email, role },
  });
  if (invite.statusCode !== 201) throw new Error(`invite failed: ${invite.body}`);
  const token = invitationToken(env, user.email);
  const accept = await as(env, user, {
    method: 'POST',
    url: '/v1/invitations/accept',
    payload: { token },
  });
  if (accept.statusCode !== 200) throw new Error(`accept failed: ${accept.body}`);
}

export function invitationToken(env: ApiTestEnv, email: string): string {
  const link = env.mailer.lastLink(email, /\/invite\/[A-Za-z0-9_-]+/);
  return link.slice('/invite/'.length);
}
