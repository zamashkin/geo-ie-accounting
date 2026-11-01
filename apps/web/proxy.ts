import { type NextRequest, NextResponse } from 'next/server';
import { REQUEST_PATH_HEADER } from './src/lib/auth/request-path';
import { signInHref } from './src/lib/auth/next-path';

// Runs before pages that need a session. Signed out (no session cookie at all) goes straight to
// `/sign-in?next=<the page asked for>`. This is an optimistic check on the cookie's presence
// only: the pages still ask the API for the session, and a stale cookie is caught there, using
// the path this proxy passes along in REQUEST_PATH_HEADER.

/** Better Auth's cookie (`__Secure-` over HTTPS, ADR 0011) and the mock auth mode's cookie. */
const SESSION_COOKIES = [
  'geo-ie-accounting.session_token',
  '__Secure-geo-ie-accounting.session_token',
  'ie_mock_session',
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;
  if (!SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    return NextResponse.redirect(new URL(signInHref(path), request.url));
  }
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/o/:path*', '/account', '/orgs/new'],
};
