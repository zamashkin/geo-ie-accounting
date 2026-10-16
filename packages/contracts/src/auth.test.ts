import { describe, expect, it } from 'vitest';
import { InvitationPreview, SessionResponse, SignInBody, SignUpBody } from './auth';

describe('auth contracts', () => {
  it('accepts a Better Auth sign-in body', () => {
    expect(SignInBody.parse({ email: 'nino@example.ge', password: 'x' })).toEqual({
      email: 'nino@example.ge',
      password: 'x',
    });
  });

  it('enforces the password policy on sign-up', () => {
    const result = SignUpBody.safeParse({
      name: 'Nino',
      email: 'nino@example.ge',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('parses a session with memberships', () => {
    const session = SessionResponse.parse({
      user: {
        id: '0199e8a0-0000-7000-8000-000000000001',
        email: 'nino@example.ge',
        name: 'Nino',
        emailVerified: true,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
      memberships: [
        { orgId: '0199e8a0-0000-7000-8000-000000000002', orgName: 'Nino IE', role: 'owner' },
      ],
    });
    expect(session.memberships[0]?.role).toBe('owner');
  });

  it('rejects an unknown invitation status', () => {
    expect(
      InvitationPreview.safeParse({
        orgName: 'Nino IE',
        email: 'acc@example.ge',
        role: 'accountant',
        expiresAt: '2026-11-15T10:00:00.000Z',
        status: 'lost',
      }).success,
    ).toBe(false);
  });
});
