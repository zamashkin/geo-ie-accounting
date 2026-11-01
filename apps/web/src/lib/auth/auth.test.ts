import { describe, expect, it, vi } from 'vitest';
import { safeNextPath } from './client';
import { AUTH_PATHS, HttpAuthClient, withAbsoluteCallback } from './http-client';
import { MockAuthClient } from './mock-client';
import { decodeMockSession, encodeMockSession } from './mock-data';

function memoryCookies() {
  let jar = '';
  return {
    get: () => jar,
    set: (cookie: string) => {
      const [pair] = cookie.split('; ');
      jar = pair?.endsWith('=') ? '' : (pair ?? '');
    },
  };
}

describe('MockAuthClient', () => {
  it('signs in, exposes a session and signs out', async () => {
    const auth = new MockAuthClient({ delayMs: 0, cookies: memoryCookies() });
    await auth.signIn({ email: 'nino.beridze@example.ge', password: 'secret123' });
    const session = await auth.getSession();
    expect(session?.user.name).toBe('Nino Beridze');
    expect(session?.memberships.length).toBeGreaterThan(0);
    await auth.signOut();
    expect(await auth.getSession()).toBeNull();
  });

  it('rejects the scripted wrong password with a 401 problem', async () => {
    const auth = new MockAuthClient({ delayMs: 0, cookies: memoryCookies() });
    await expect(
      auth.signIn({ email: 'a@b.ge', password: 'wrong-password' }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'unauthenticated',
    });
  });

  it('creates no session on sign-up (verification email first)', async () => {
    const auth = new MockAuthClient({ delayMs: 0, cookies: memoryCookies() });
    await auth.signUp({ email: 'new@example.ge', name: 'New', password: 'long-enough-pw' });
    expect(await auth.getSession()).toBeNull();
  });

  it('rejects unverified emails with 403', async () => {
    const auth = new MockAuthClient({ delayMs: 0, cookies: memoryCookies() });
    await expect(
      auth.signIn({ email: 'unverified@example.ge', password: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('returns field errors for a taken email', async () => {
    const auth = new MockAuthClient({ delayMs: 0, cookies: memoryCookies() });
    const err: unknown = await auth
      .signUp({ email: 'taken@example.ge', name: 'X', password: 'longenough' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'validation_failed' });
  });

  it('refuses expired invitations', async () => {
    const auth = new MockAuthClient({ delayMs: 0, cookies: memoryCookies() });
    await expect(auth.acceptInvitation('expired')).rejects.toMatchObject({ code: 'conflict' });
    await expect(auth.getInvitation('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('mock session cookie', () => {
  it('round-trips and rejects junk', () => {
    const user = { email: 'n@example.ge', name: 'Nino; Beridze' };
    expect(decodeMockSession(encodeMockSession(user))).toEqual(user);
    expect(decodeMockSession('%7Bnot json')).toBeNull();
    expect(decodeMockSession(encodeURIComponent('{"email":1}'))).toBeNull();
  });
});

describe('HttpAuthClient', () => {
  it('posts JSON with credentials to Better Auth', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    await new HttpAuthClient('http://api', fetchImpl).signIn({ email: 'a@b.ge', password: 'x' });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`http://api${AUTH_PATHS.signIn}`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
  });

  it('maps a 401 on /v1/me to "signed out"', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(new HttpAuthClient('http://api', fetchImpl).getSession()).resolves.toBeNull();
  });

  it('turns error bodies into ApiError', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'forbidden', message: 'No' }), { status: 403 }),
      );
    await expect(
      new HttpAuthClient('http://api', fetchImpl).getInvitation('t'),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/o/1/imports', '/o/1/imports'],
    ['//evil.example', '/fallback'],
    ['/\\evil.example', '/fallback'],
    ['https://evil.example', '/fallback'],
    ['javascript:alert(1)', '/fallback'],
    ['/\t/evil.example', '/fallback'],
    ['/o/1\n', '/fallback'],
    ['/o/1?year=2025#top', '/o/1?year=2025#top'],
    ['/../../etc', '/etc'],
    ['', '/fallback'],
    [null, '/fallback'],
  ])('%j -> %s', (next, expected) => {
    expect(safeNextPath(next, '/fallback')).toBe(expected);
  });
});

describe('withAbsoluteCallback', () => {
  it('puts a relative callback on the web origin', () => {
    expect(
      withAbsoluteCallback({ email: 'a@b.ge', callbackURL: '/o/1' }, 'http://localhost:3000'),
    ).toEqual({ email: 'a@b.ge', callbackURL: 'http://localhost:3000/o/1' });
  });

  it('leaves bodies without a relative callback alone', () => {
    const body: { email: string; callbackURL?: string } = { email: 'a@b.ge' };
    expect(withAbsoluteCallback(body, 'http://localhost:3000')).toBe(body);
    expect(withAbsoluteCallback({ callbackURL: '/x' }, undefined)).toEqual({ callbackURL: '/x' });
  });
});
