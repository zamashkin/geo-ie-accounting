import { z } from 'zod';
import { Role } from './enums';
import { Timestamp, Uuid } from './primitives';

// Auth and session shapes shared by the web forms (WS-04) and the API (WS-05, Better Auth).
// The sign-in/sign-up bodies match what Better Auth's email+password and magic-link
// endpoints accept, so the web can post them unchanged.

/** Better Auth's default password policy (minPasswordLength 8, maxPasswordLength 128). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const Password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const SignInBody = z
  .object({
    email: z.email('Enter a valid email address'),
    password: z.string().min(1, 'Enter your password'),
    rememberMe: z.boolean().optional(),
  })
  .meta({ id: 'SignInBody' });
export type SignInBody = z.output<typeof SignInBody>;

export const SignUpBody = z
  .object({
    name: z.string().trim().min(1, 'Enter your name').max(200),
    email: z.email('Enter a valid email address'),
    password: Password,
  })
  .meta({ id: 'SignUpBody' });
export type SignUpBody = z.output<typeof SignUpBody>;

export const MagicLinkBody = z
  .object({
    email: z.email('Enter a valid email address'),
    /** Where the link lands after verification (a path on the web app). */
    callbackURL: z.string().startsWith('/').optional(),
  })
  .meta({ id: 'MagicLinkBody' });
export type MagicLinkBody = z.output<typeof MagicLinkBody>;

/** One workspace the signed-in user belongs to. */
export const SessionMembership = z
  .object({
    orgId: Uuid,
    orgName: z.string(),
    role: Role,
  })
  .meta({ id: 'SessionMembership' });
export type SessionMembership = z.output<typeof SessionMembership>;

/** `GET /v1/me`: the current user and their workspaces. 401 when signed out. */
export const SessionResponse = z
  .object({
    user: z.object({ id: Uuid, email: z.email(), name: z.string() }),
    memberships: z.array(SessionMembership),
    expiresAt: Timestamp,
  })
  .meta({ id: 'SessionResponse' });
export type SessionResponse = z.output<typeof SessionResponse>;

/** `GET /v1/invitations/:token`: what the invite page shows before accepting. Public. */
export const InvitationPreview = z
  .object({
    orgName: z.string(),
    email: z.email(),
    role: Role,
    invitedByName: z.string().nullable(),
    expiresAt: Timestamp,
    /** `pending` can be accepted; the others explain why not. */
    status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
  })
  .meta({ id: 'InvitationPreview' });
export type InvitationPreview = z.output<typeof InvitationPreview>;

/** `POST /v1/invitations/:token/accept` response: the workspace the user joined. */
export const AcceptInvitationResponse = z
  .object({ orgId: Uuid, role: Role })
  .meta({ id: 'AcceptInvitationResponse' });
export type AcceptInvitationResponse = z.output<typeof AcceptInvitationResponse>;
