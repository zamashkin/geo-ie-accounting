// Password reset, password change and the account's session list.
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
  type TestUser,
} from '../testing/env';

let env: ApiTestEnv;

beforeAll(async () => {
  env = await startApiTestEnv();
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

const NEW_PASSWORD = 'a-brand-new-password-2026';

const signIn = (email: string, password: string) =>
  env.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers: { origin: WEB_ORIGIN },
    payload: { email, password },
  });

const requestReset = (email: string, redirectTo?: string) =>
  env.app.inject({
    method: 'POST',
    url: '/v1/auth/request-password-reset',
    headers: { origin: WEB_ORIGIN },
    payload: { email, ...(redirectTo ? { redirectTo } : {}) },
  });

const me = (user: TestUser | { cookie: string }) =>
  env.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: user.cookie } });

describe('password reset', () => {
  it('mails a link that lands on the web page, sets the password once and ends sessions', async () => {
    const user = await signUp(env);
    const res = await requestReset(user.email, `${WEB_ORIGIN}/reset-password?next=%2Fo%2Fx`);
    expect(res.statusCode).toBe(200);

    const mail = env.mailer.outbox.findLast((m) => m.to === user.email);
    expect(mail?.subject).toBe('Reset your geo-ie-accounting password');
    const link = env.mailer.lastLink(user.email);
    const landing = await env.app.inject({ method: 'GET', url: pathOf(link) });
    expect(landing.statusCode).toBe(302);
    const target = new URL(String(landing.headers.location));
    expect(target.origin + target.pathname).toBe(`${WEB_ORIGIN}/reset-password`);
    expect(target.searchParams.get('next')).toBe('/o/x');
    const token = target.searchParams.get('token');
    expect(token).toBeTruthy();

    const reset = (newPassword: string) =>
      env.app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        headers: { origin: WEB_ORIGIN },
        payload: { token, newPassword },
      });
    expect((await reset(NEW_PASSWORD)).statusCode).toBe(200);
    expect((await me(user)).statusCode).toBe(401);
    expect((await signIn(user.email, PASSWORD)).statusCode).toBe(401);
    expect((await signIn(user.email, NEW_PASSWORD)).statusCode).toBe(200);

    const reused = await reset('yet-another-password-1');
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    const relanding = await env.app.inject({ method: 'GET', url: pathOf(link) });
    expect(String(relanding.headers.location)).toContain('error=INVALID_TOKEN');
  });

  it('answers the same for unknown addresses and sends nothing', async () => {
    const known = await signUp(env);
    const unknown = `${uuidv7()}@example.test`;
    const [a, b] = [await requestReset(known.email), await requestReset(unknown)];
    expect(b.statusCode).toBe(a.statusCode);
    expect(b.json()).toEqual(a.json());
    expect(env.mailer.outbox.some((m) => m.to === unknown)).toBe(false);
  });

  it('points a link without a redirect at the web origin, not the API', async () => {
    const user = await signUp(env);
    await requestReset(user.email);
    const link = new URL(env.mailer.lastLink(user.email));
    expect(link.searchParams.get('callbackURL')).toBe(`${WEB_ORIGIN}/reset-password`);
  });
});

describe('account', () => {
  it('changes the password with the current one and signs out other sessions', async () => {
    const user = await signUp(env);
    const other = cookieFrom(await signIn(user.email, PASSWORD));

    const wrong = await as(env, user, {
      method: 'POST',
      url: '/v1/auth/change-password',
      payload: { currentPassword: 'not-my-password-1', newPassword: NEW_PASSWORD },
    });
    expect(wrong.statusCode).toBe(400);

    const res = await as(env, user, {
      method: 'POST',
      url: '/v1/auth/change-password',
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
    });
    expect(res.statusCode).toBe(200);
    expect((await me({ cookie: other })).statusCode).toBe(401);
    expect((await me({ cookie: cookieFrom(res) })).statusCode).toBe(200);
  });

  it('lists sessions without tokens and revokes another one by id', async () => {
    const user = await signUp(env);
    const other = cookieFrom(await signIn(user.email, PASSWORD));
    const list = await as(env, user, { method: 'GET', url: '/v1/me/sessions' });
    expect(list.statusCode).toBe(200);
    const { items } = list.json<{ items: { id: string; current: boolean }[] }>();
    expect(items).toHaveLength(2);
    expect(list.body).not.toMatch(/token/i);
    const current = items.find((s) => s.current);
    const notCurrent = items.find((s) => !s.current);

    const self = await as(env, user, {
      method: 'POST',
      url: `/v1/me/sessions/${current?.id}/revoke`,
    });
    expect(self.statusCode).toBe(409);
    const revoke = await as(env, user, {
      method: 'POST',
      url: `/v1/me/sessions/${notCurrent?.id}/revoke`,
    });
    expect(revoke.statusCode).toBe(200);
    expect((await me({ cookie: other })).statusCode).toBe(401);
    expect((await me(user)).statusCode).toBe(200);

    // Someone else's session id is just not found.
    const stranger = await signUp(env);
    const foreign = await as(env, stranger, {
      method: 'POST',
      url: `/v1/me/sessions/${current?.id}/revoke`,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('changes the email only after both links are opened', async () => {
    const user = await signUp(env);
    const newEmail = `${uuidv7()}@example.test`;
    const res = await as(env, user, {
      method: 'POST',
      url: '/v1/auth/change-email',
      payload: { newEmail, callbackURL: `${WEB_ORIGIN}/account` },
    });
    expect(res.statusCode).toBe(200);
    const confirm = await env.app.inject({
      method: 'GET',
      url: pathOf(env.mailer.lastLink(user.email)),
      headers: { cookie: user.cookie },
    });
    expect(confirm.statusCode).toBe(302);
    expect((await me(user)).json()).toMatchObject({ user: { email: user.email } });
    const verify = await env.app.inject({
      method: 'GET',
      url: pathOf(env.mailer.lastLink(newEmail)),
      headers: { cookie: user.cookie },
    });
    expect(verify.headers.location).toBe(`${WEB_ORIGIN}/account`);
    expect((await me(user)).json()).toMatchObject({ user: { email: newEmail } });
  });
});
