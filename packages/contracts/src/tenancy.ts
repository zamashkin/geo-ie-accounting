import { z } from 'zod';
import { Invitation, Organization, User } from './entities';
import { Role } from './enums';
import { paginated } from './pagination';
import { IsoDate, Timestamp, Uuid } from './primitives';

// Requests and responses of the auth, organisation, member and invitation routes (WS-05).

// ── Headers and params ──────────────────────────────────────────────────────────────────

/** `Idempotency-Key` request header: 1–255 visible ASCII characters (a UUID works well). */
export const IdempotencyKey = z
  .string()
  .regex(/^[\x21-\x7e]{1,255}$/, 'Expected 1-255 visible ASCII characters')
  .meta({ description: 'Client-chosen key; replays return the stored response for 24 h.' });
export type IdempotencyKey = z.output<typeof IdempotencyKey>;

/**
 * Header schema for mutating routes, so the key shows up in OpenAPI. Loose: validation must not
 * strip the other headers (cookie, origin) from the request.
 */
export const MutationHeaders = z.looseObject({ 'idempotency-key': IdempotencyKey.optional() });

export const OrgParams = z.object({ orgId: Uuid });
export type OrgParams = z.output<typeof OrgParams>;

export const InvitationParams = OrgParams.extend({ invitationId: Uuid });
export type InvitationParams = z.output<typeof InvitationParams>;

// ── Session ─────────────────────────────────────────────────────────────────────────────

export const SessionUser = User.extend({ emailVerified: z.boolean() }).meta({ id: 'SessionUser' });
export type SessionUser = z.output<typeof SessionUser>;

export const MembershipSummary = z
  .object({ orgId: Uuid, orgName: z.string(), role: Role })
  .meta({ id: 'MembershipSummary' });
export type MembershipSummary = z.output<typeof MembershipSummary>;

/** `GET /v1/me`: the signed-in user and the orgs they can open. */
export const MeResponse = z
  .object({ user: SessionUser, memberships: z.array(MembershipSummary) })
  .meta({ id: 'MeResponse' });
export type MeResponse = z.output<typeof MeResponse>;

// ── Organisations ───────────────────────────────────────────────────────────────────────

export const CreateOrganizationRequest = z
  .object({
    name: z.string().trim().min(1).max(200),
    taxId: z.string().trim().min(1).max(50).nullable().optional(),
    sbsEffectiveFrom: IsoDate.nullable().optional(),
  })
  .meta({ id: 'CreateOrganizationRequest' });
export type CreateOrganizationRequest = z.output<typeof CreateOrganizationRequest>;

export const OrganizationWithRole = Organization.extend({ role: Role }).meta({
  id: 'OrganizationWithRole',
});
export type OrganizationWithRole = z.output<typeof OrganizationWithRole>;

export const OrganizationList = paginated(OrganizationWithRole).meta({ id: 'OrganizationList' });
export type OrganizationList = z.output<typeof OrganizationList>;

// ── Members ─────────────────────────────────────────────────────────────────────────────

export const Member = z
  .object({
    userId: Uuid,
    email: z.email(),
    name: z.string(),
    role: Role,
    /** When the user joined the org. */
    createdAt: Timestamp,
  })
  .meta({ id: 'Member' });
export type Member = z.output<typeof Member>;

export const MemberList = paginated(Member).meta({ id: 'MemberList' });
export type MemberList = z.output<typeof MemberList>;

// ── Invitations ─────────────────────────────────────────────────────────────────────────

export const CreateInvitationRequest = z
  .object({ email: z.email().max(254), role: Role })
  .meta({ id: 'CreateInvitationRequest' });
export type CreateInvitationRequest = z.output<typeof CreateInvitationRequest>;

export const InvitationList = paginated(Invitation).meta({ id: 'InvitationList' });
export type InvitationList = z.output<typeof InvitationList>;

/** The secret from the invitation link. Sent in a body, never in a URL, so it stays out of logs. */
export const InvitationTokenRequest = z
  .object({ token: z.string().min(20).max(200) })
  .meta({ id: 'InvitationTokenRequest' });
export type InvitationTokenRequest = z.output<typeof InvitationTokenRequest>;

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export const InvitationStatus = z.enum(INVITATION_STATUSES);
export type InvitationStatus = z.output<typeof InvitationStatus>;

/** What the invite page shows before the user accepts. */
export const InvitationPreview = z
  .object({
    orgName: z.string(),
    email: z.email(),
    role: Role,
    status: InvitationStatus,
    expiresAt: Timestamp,
  })
  .meta({ id: 'InvitationPreview' });
export type InvitationPreview = z.output<typeof InvitationPreview>;

export const AcceptInvitationResponse = z
  .object({ orgId: Uuid, orgName: z.string(), role: Role })
  .meta({ id: 'AcceptInvitationResponse' });
export type AcceptInvitationResponse = z.output<typeof AcceptInvitationResponse>;
