// Post-sign-in targets (`?next=`). Only paths on this site are accepted, so a crafted link
// cannot send someone elsewhere after they sign in (open redirect). No runtime dependencies:
// proxy.ts imports this too.

const BASE = 'http://next-path.invalid';
// Backslashes (browsers read `/\host` as `//host`) and control characters (browsers drop tabs
// and newlines, so `/<tab>/host` becomes `//host`).
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const UNSAFE_CHARS = /[\\\u0000-\u001f\u007f]/;

/**
 * `next` if it is a same-origin relative path (`/o/1/imports?year=2025`), else `fallback`.
 * Absolute URLs (`https:`, `javascript:`) and protocol-relative `//host` are rejected too.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || UNSAFE_CHARS.test(next)) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/sign-in?next=<path>` for a page that needs a session. */
export function signInHref(path: string): string {
  const next = safeNextPath(path, '/');
  return next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`;
}
