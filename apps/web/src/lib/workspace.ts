// The last-used workspace, remembered in a cookie so `/` reopens it. The cookie holds only an
// org id and is not trusted: `/` checks it against the user's memberships from `GET /v1/me`.

/** Cookie with the id of the workspace the user opened last. */
export const LAST_ORG_COOKIE = 'ie_last_org';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * The org `/` opens: the remembered one while the user is still a member, else the first
 * membership, else null (no workspace yet).
 */
export function pickWorkspace(
  memberships: readonly { orgId: string }[],
  lastOrgId: string | undefined,
): string | null {
  if (lastOrgId && memberships.some((m) => m.orgId === lastOrgId)) return lastOrgId;
  return memberships[0]?.orgId ?? null;
}

/** `document.cookie` assignment that remembers `orgId` for a year. */
export function lastOrgCookie(orgId: string, secure: boolean): string {
  return [
    `${LAST_ORG_COOKIE}=${encodeURIComponent(orgId)}`,
    'Path=/',
    `Max-Age=${ONE_YEAR_SECONDS}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
