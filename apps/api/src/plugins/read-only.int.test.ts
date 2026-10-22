// The read-only demo login (ADR 0016): reads work, every change is refused with 403
// demo_read_only, even with the owner role; sign-in and sign-out still work.
import { setMembership, upsertPasswordLogin } from '@geo-ie-accounting/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  cookieFrom,
  createOrg,
  signUp,
  startApiTestEnv,
  WEB_ORIGIN,
  type ApiTestEnv,
  type TestUser,
} from '../testing/env';

const DEMO = { email: 'demo@example.test', password: 'read-only-demo-pass', name: 'Demo' };

async function signIn(env: ApiTestEnv, email: string, password: string) {
  return env.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers: { origin: WEB_ORIGIN },
    payload: { email, password },
  });
}

describe('read-only login, DEMO_MODE on, sign-up off', () => {
  let env: ApiTestEnv;
  let demo: TestUser;
  let orgId: string;

  beforeAll(async () => {
    env = await startApiTestEnv({ demo: { enabled: true }, signUpEnabled: false });
    const ownerId = await upsertPasswordLogin(env.tdb.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: 'owner-password-1',
      readOnly: false,
    });
    const ownerSignIn = await signIn(env, 'owner@example.test', 'owner-password-1');
    const owner = { id: ownerId, email: 'owner@example.test', cookie: cookieFrom(ownerSignIn) };
    orgId = await createOrg(env, owner, 'Demo workspace');

    const demoId = await upsertPasswordLogin(env.tdb.db, { ...DEMO, readOnly: true });
    // The owner role on purpose: the flag wins over any role.
    await setMembership(env.tdb.db, orgId, demoId, 'owner');
    const res = await signIn(env, DEMO.email, DEMO.password);
    expect(res.statusCode).toBe(200);
    demo = { id: demoId, email: DEMO.email, cookie: cookieFrom(res) };
  });

  afterAll(async () => {
    await (env as ApiTestEnv | undefined)?.close();
  });

  it('publishes the demo login and that sign-up is off', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/v1/public-config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      demo: { email: 'demo@geo-ie-accounting.local', password: 'try-the-demo-2026' },
      signUpEnabled: false,
    });
  });

  it('reads like any member and says it is read-only', async () => {
    const me = await as(env, demo, { method: 'GET', url: '/v1/me' });
    expect(me.json()).toMatchObject({ user: { readOnly: true }, memberships: [{ orgId }] });
    const accounts = await as(env, demo, { method: 'GET', url: `/v1/orgs/${orgId}/accounts` });
    expect(accounts.statusCode).toBe(200);
  });

  it.each([
    ['PATCH', '/v1/orgs/:org', { name: 'Renamed' }],
    ['POST', '/v1/orgs/:org/rules', { name: 'x', descriptionContains: 'x' }],
    ['POST', '/v1/orgs/:org/declarations/2025-01/file', {}],
    ['POST', '/v1/orgs', { name: 'Another' }],
    ['POST', '/v1/auth/change-password', { currentPassword: 'a', newPassword: 'b' }],
    ['POST', '/v1/auth/update-user', { name: 'Hacker' }],
  ] as const)('refuses %s %s with 403 demo_read_only', async (method, path, payload) => {
    const url = path.replace(':org', orgId);
    const res = await as(env, demo, { method, url, payload });
    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ code: 'demo_read_only', status: 403 });
  });

  it('refuses a password reset for the demo address, signed out', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/request-password-reset',
      headers: { origin: WEB_ORIGIN },
      payload: { email: DEMO.email, redirectTo: `${WEB_ORIGIN}/reset-password` },
    });
    expect(res.statusCode).toBe(403);
    expect(env.mailer.outbox.filter((m) => m.to === DEMO.email)).toEqual([]);
  });

  it('turns sign-up off', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-up/email',
      headers: { origin: WEB_ORIGIN },
      payload: { email: 'new@example.test', password: 'a-long-password-1', name: 'New' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('signs out', async () => {
    const res = await as(env, demo, { method: 'POST', url: '/v1/auth/sign-out', payload: {} });
    expect(res.statusCode).toBe(200);
  });
});

describe('read-only login, DEMO_MODE off', () => {
  let env: ApiTestEnv;

  beforeAll(async () => {
    env = await startApiTestEnv();
    await upsertPasswordLogin(env.tdb.db, { ...DEMO, readOnly: true });
  });

  afterAll(async () => {
    await (env as ApiTestEnv | undefined)?.close();
  });

  it('cannot sign in, and the config offers no demo', async () => {
    const res = await signIn(env, DEMO.email, DEMO.password);
    expect(res.statusCode).toBe(403);
    const config = await env.app.inject({ method: 'GET', url: '/v1/public-config' });
    expect(config.json()).toEqual({ demo: null, signUpEnabled: true });
  });

  it('leaves ordinary sign-up alone', async () => {
    const user = await signUp(env);
    expect(user.cookie).toContain('session_token');
  });
});
