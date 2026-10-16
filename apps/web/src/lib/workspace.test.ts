import { describe, expect, it } from 'vitest';
import { LAST_ORG_COOKIE, lastOrgCookie, pickWorkspace } from './workspace';

const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
const memberships = [{ orgId: A }, { orgId: B }];

describe('pickWorkspace', () => {
  it('reopens the remembered workspace', () => {
    expect(pickWorkspace(memberships, B)).toBe(B);
  });

  it('falls back to the first membership when nothing is remembered', () => {
    expect(pickWorkspace(memberships, undefined)).toBe(A);
    expect(pickWorkspace(memberships, '')).toBe(A);
  });

  it('ignores a workspace the user is no longer a member of', () => {
    expect(pickWorkspace(memberships, '01900000-0000-7000-8000-0000000000ff')).toBe(A);
  });

  it('has nothing to open without memberships', () => {
    expect(pickWorkspace([], B)).toBeNull();
  });
});

describe('lastOrgCookie', () => {
  it('is a year-long, site-wide, lax cookie, secure on https', () => {
    expect(lastOrgCookie(A, false)).toBe(
      `${LAST_ORG_COOKIE}=${A}; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
    expect(lastOrgCookie(A, true)).toMatch(/; Secure$/);
  });
});
