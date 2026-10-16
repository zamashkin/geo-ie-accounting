import { z } from 'zod';
import { Role } from './enums';
import { Timestamp, Uuid } from './primitives';

// Auth and session shapes for the web forms (WS-04). They mirror what WS-05 ships on main
// (Better Auth under /v1/auth, and packages/contracts/src/tenancy.ts for /v1/me and
// invitations). At merge, keep tenancy.ts as the source of truth and point the web at it;
// the duplicates here (SessionResponse, InvitationPreview, AcceptInvitationResponse) go.

/** WS-05's password policy (12–128). */
export const PASSWORD_MIN_LENGTH = 12;
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
    /** Where the email-verification link lands. */
    callbackURL: z.string().startsWith('/').optional(),
  })
  .meta({ id: 'SignUpBody' });
export type SignUpBody = z.output<typeof SignUpBody>;

export const MagicLinkBody = z
  .object({
    email: z.email('Enter a valid email address'),
    name: z.string().optional(),
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
    user: z.object({
      id: Uuid,
      email: z.email(),
      name: z.string(),
      emailVerified: z.boolean(),
      createdAt: Timestamp,
    }),
    memberships: z.array(SessionMembership),
  })
  .meta({ id: 'SessionResponse' });
export type SessionResponse = z.output<typeof SessionResponse>;

/** `POST /v1/invitations/preview {token}`: what the invite page shows. No auth. */
export const InvitationPreview = z
  .object({
    orgName: z.string(),
    email: z.email(),
    role: Role,
    expiresAt: Timestamp,
    /** `pending` can be accepted; the others explain why not. */
    status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
  })
  .meta({ id: 'InvitationPreview' });
export type InvitationPreview = z.output<typeof InvitationPreview>;

/** `POST /v1/invitations/accept {token}` response: the workspace the user joined. */
export const AcceptInvitationResponse = z
  .object({ orgId: Uuid, orgName: z.string(), role: Role })
  .meta({ id: 'AcceptInvitationResponse' });
export type AcceptInvitationResponse = z.output<typeof AcceptInvitationResponse>;
