import type { InvitationPreview, MeResponse } from '@geo-ie-accounting/contracts';

// Placeholder data for the mock auth mode and the org switcher until WS-05 lands.
// The ids are stable so URLs like /o/<id> survive reloads.

export const MOCK_SESSION_COOKIE = 'ie_mock_session';

export const DEMO_ORGS = [
  { orgId: '0199f2a0-0000-7000-8000-000000000001', orgName: 'Nino Beridze IE', role: 'owner' },
  {
    orgId: '0199f2a0-0000-7000-8000-000000000002',
    orgName: 'Giorgi Kapanadze IE',
    role: 'accountant',
  },
  { orgId: '0199f2a0-0000-7000-8000-000000000003', orgName: 'Tamar Lomidze IE', role: 'viewer' },
] as const satisfies MeResponse['memberships'];

export function demoSession(user: { email: string; name: string }): MeResponse {
  return {
    user: {
      id: '0199f2a0-0000-7000-8000-0000000000aa',
      ...user,
      emailVerified: true,
      createdAt: '2026-10-01T10:00:00.000Z',
    },
    memberships: [...DEMO_ORGS],
  };
}

/** Invitation tokens the mock understands: `demo` is valid, the others show each error state. */
export const MOCK_INVITATIONS: Record<string, InvitationPreview> = {
  demo: {
    orgName: 'Nino Beridze IE',
    email: 'accountant@example.ge',
    role: 'accountant',
    expiresAt: '2026-12-31T20:00:00.000Z',
    status: 'pending',
  },
  expired: {
    orgName: 'Nino Beridze IE',
    email: 'accountant@example.ge',
    role: 'viewer',
    expiresAt: '2026-01-01T00:00:00.000Z',
    status: 'expired',
  },
};

/** Encodes the mock user in a cookie the server layout can read. Not a security boundary. */
export function encodeMockSession(user: { email: string; name: string }): string {
  return encodeURIComponent(JSON.stringify(user));
}

export function decodeMockSession(
  value: string | undefined,
): { email: string; name: string } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { email?: unknown }).email === 'string' &&
      typeof (parsed as { name?: unknown }).name === 'string'
    ) {
      const { email, name } = parsed as { email: string; name: string };
      return { email, name };
    }
  } catch {
    // fall through
  }
  return null;
}
