import { DEMO, seedDemo } from '@geo-ie-accounting/db';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  cookieFrom,
  PASSWORD,
  pathOf,
  signUp,
  startApiTestEnv,
  WEB_ORIGIN,
  type ApiTestEnv,
} from '../testing/env';

let env: ApiTestEnv;

beforeAll(async () => {
  env = await startApiTestEnv();
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

const signIn = (email: string, password: string) =>
  env.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers: { origin: WEB_ORIGIN },
    payload: { email, password },
  });

describe('email + password', () => {
  it('refuses sign-in until the email is verified, then sets an httpOnly session cookie', async () => {
    const email = `${uuidv7()}@example.test`;
    const signUpRes = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-up/email',
      headers: { origin: WEB_ORIGIN },
      payload: { email, password: PASSWORD, name: 'Nino', callbackURL: `${WEB_ORIGIN}/` },
    });
    expect(signUpRes.statusCode).toBe(200);
    expect(cookieFrom(signUpRes)).not.toContain('session_token');

    expect((await signIn(email, PASSWORD)).statusCode).toBe(403);

    const verify = await env.app.inject({ method: 'GET', url: pathOf(env.mailer.lastLink(email)) });
    expect(verify.statusCode).toBe(302);
    expect(verify.headers.location).toBe(`${WEB_ORIGIN}/`);

    const res = await signIn(email, PASSWORD);
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/geo-ie-accounting\.session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const me = await env.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: cookieFrom(res) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { email, name: 'Nino', emailVerified: true },
      memberships: [],
    });
  });

  it('rejects a short password and a wrong one', async () => {
    const short = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-up/email',
      headers: { origin: WEB_ORIGIN },
      payload: { email: `${uuidv7()}@example.test`, password: 'short', name: 'X' },
    });
    expect(short.statusCode).toBe(400);
    const user = await signUp(env);
    expect((await signIn(user.email, 'wrong-password-123')).statusCode).toBe(401);
  });

  it('signs in the seeded demo user with the documented password', async () => {
    await seedDemo(env.tdb.db);
    const res = await signIn(DEMO.userEmail, DEMO.password);
    expect(res.statusCode).toBe(200);
    const me = await env.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: cookieFrom(res) },
    });
    expect(me.json()).toMatchObject({
      memberships: [{ orgId: DEMO.orgId, orgName: DEMO.orgName, role: 'owner' }],
    });
  });

  it('ends the session on sign-out', async () => {
    const user = await signUp(env);
    const out = await as(env, user, { method: 'POST', url: '/v1/auth/sign-out', payload: {} });
    expect(out.statusCode).toBe(200);
    const me = await as(env, user, { method: 'GET', url: '/v1/me' });
    expect(me.statusCode).toBe(401);
  });
});

describe('magic link', () => {
  it('mails a single-use link that signs the user in (and signs up new emails)', async () => {
    const email = `${uuidv7()}@example.test`;
    const req = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/magic-link',
      headers: { origin: WEB_ORIGIN },
      payload: { email, callbackURL: `${WEB_ORIGIN}/` },
    });
    expect(req.statusCode).toBe(200);
    const link = env.mailer.lastLink(email);
    expect(link.startsWith('http://localhost:4000/v1/auth/magic-link/verify?token=')).toBe(true);

    const first = await env.app.inject({ method: 'GET', url: pathOf(link) });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe(`${WEB_ORIGIN}/`);
    const me = await env.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: cookieFrom(first) },
    });
    expect(me.json()).toMatchObject({ user: { email, emailVerified: true } });

    const again = await env.app.inject({ method: 'GET', url: pathOf(link) });
    expect(cookieFrom(again)).not.toMatch(/session_token=[^;]+/);
  });

  it('never redirects to a callback URL outside the trusted origins', async () => {
    const email = `${uuidv7()}@example.test`;
    const res = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/magic-link',
      headers: { origin: WEB_ORIGIN },
      payload: { email, callbackURL: 'https://evil.example/' },
    });
    expect(res.statusCode).toBe(403);
    expect(env.mailer.outbox.some((m) => m.to === email)).toBe(false);
  });

  it('refuses cookie-carrying auth requests from a foreign origin', async () => {
    const user = await signUp(env);
    const res = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-out',
      headers: { origin: 'https://evil.example', cookie: user.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('CSRF and authentication on /v1', () => {
  it('requires a session', async () => {
    const res = await as(env, null, { method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('blocks cookie-authenticated mutations from other origins or without an Origin', async () => {
    const user = await signUp(env);
    for (const headers of [{ origin: 'https://evil.example' }, {}]) {
      const res = await env.app.inject({
        method: 'POST',
        url: '/v1/orgs',
        headers: { cookie: user.cookie, ...headers },
        payload: { name: 'CSRF IE' },
      });
      expect(res.statusCode).toBe(403);
    }
    const referer = await env.app.inject({
      method: 'POST',
      url: '/v1/orgs',
      headers: { cookie: user.cookie, referer: `${WEB_ORIGIN}/orgs/new` },
      payload: { name: 'Same-origin IE' },
    });
    expect(referer.statusCode).toBe(201);
  });

  it('lets safe methods through without an Origin', async () => {
    const user = await signUp(env);
    const res = await env.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it('answers CORS preflight for the web origin with credentials', async () => {
    const res = await env.app.inject({
      method: 'OPTIONS',
      url: '/v1/orgs',
      headers: {
        origin: WEB_ORIGIN,
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'content-type,idempotency-key',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(String(res.headers['access-control-allow-methods'])).toContain('PATCH');
  });
});
