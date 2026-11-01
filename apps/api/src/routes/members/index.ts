import { createHash, randomBytes } from 'node:crypto';
import {
  AcceptInvitationResponse,
  CreateInvitationRequest,
  Invitation,
  InvitationList,
  InvitationParams,
  InvitationPreview,
  InvitationTokenRequest,
  Member,
  MemberList,
  MemberParams,
  MutationHeaders,
  OrgParams,
  PaginationQuery,
  UpdateMemberRequest,
  Uuid,
  type InvitationStatus,
  type Role,
} from '@geo-ie-accounting/contracts';
import {
  addMember,
  createInvitation,
  findInvitationByTokenHash,
  findMemberByEmail,
  findPendingInvitationForEmail,
  getInvitation,
  getMember,
  getMembership,
  getOrganizationForUser,
  listMembers,
  listPendingInvitations,
  lockOrgMemberships,
  markInvitationAccepted,
  normaliseEmail,
  removeMember,
  renewInvitation,
  revokeInvitation,
  setMemberRole,
  type InvitationRow,
  type MemberRow,
} from '@geo-ie-accounting/db';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { invitationMail } from '../../auth/emails';
import type { Mailer } from '../../auth/mailer';
import { requireAuth, requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Invitation tokens: 32 random bytes, base64url. Only their sha256 is stored. */
export const hashInvitationToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

function toInvitationDto(inv: InvitationRow): Invitation {
  return {
    id: inv.id,
    orgId: inv.orgId,
    email: inv.email,
    role: inv.role,
    invitedBy: inv.invitedBy,
    expiresAt: inv.expiresAt.toISOString(),
    acceptedAt: inv.acceptedAt?.toISOString() ?? null,
    revokedAt: inv.revokedAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
  };
}

function invitationStatus(inv: InvitationRow, now = new Date()): InvitationStatus {
  if (inv.acceptedAt) return 'accepted';
  if (inv.revokedAt) return 'revoked';
  if (inv.expiresAt <= now) return 'expired';
  return 'pending';
}

const NOT_PENDING_DETAIL: Record<Exclude<InvitationStatus, 'pending'>, string> = {
  accepted: 'This invitation has already been accepted.',
  revoked: 'This invitation was revoked.',
  expired: 'This invitation has expired. Ask for a new one.',
};

const toMemberDto = (m: MemberRow): Member => ({ ...m, createdAt: m.createdAt.toISOString() });

export const LAST_OWNER_DETAIL =
  'A workspace needs at least one owner. Make another member an owner first.';

/**
 * Locks the org's membership rows and checks a change to `userId` (a new role, or `null` for
 * removal) against them: the member must exist, at least one owner must remain, and only an
 * owner may change someone else. The lock is held until the request's transaction ends, so two
 * concurrent changes (two owners demoting each other) run one after the other and the second
 * sees the first one's result.
 */
async function checkMembershipChange(req: FastifyRequest, userId: string, role: Role | null) {
  const { orgId } = req.membership;
  const rows = await lockOrgMemberships(req.tx, orgId);
  // The guard checked the caller's role before the lock; check it again under the lock (an
  // owner demoted a moment ago by another owner is no longer one).
  const actor = rows.find((r) => r.userId === req.user.id);
  if (userId !== req.user.id && actor?.role !== 'owner') {
    throw new HttpProblem(403, 'forbidden', 'Only an owner can change other members.');
  }
  const target = rows.find((r) => r.userId === userId);
  if (!target) throw new HttpProblem(404, 'not_found', 'Member not found.');
  const ownersLeft = rows.filter((r) =>
    r.userId === userId ? role === 'owner' : r.role === 'owner',
  ).length;
  if (ownersLeft === 0) throw new HttpProblem(409, 'last_owner', LAST_OWNER_DETAIL);
  return target;
}

export interface MemberRoutesOptions {
  /** Base of the invite link: `${webOrigin}/invite/${token}`. */
  webOrigin: string;
  mailer: Mailer;
}

export const memberRoutes: FastifyPluginAsyncZod<MemberRoutesOptions> = async (app, opts) => {
  // ── Members ─────────────────────────────────────────────────────────────────────────

  app.get(
    '/v1/orgs/:orgId/members',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listMembers',
        tags: ['members'],
        summary: 'Members of the organization',
        params: OrgParams,
        querystring: PaginationQuery,
        response: { 200: MemberList, default: problemResponse },
      },
    },
    async (req) => {
      const { limit, cursor } = req.query;
      if (cursor !== undefined && !Uuid.safeParse(cursor).success) {
        throw new HttpProblem(400, 'bad_request', 'Invalid cursor.');
      }
      const rows = await listMembers(app.db, req.membership.orgId, { cursor, limit: limit + 1 });
      const page = rows.slice(0, limit);
      return {
        items: page.map(toMemberDto),
        nextCursor: rows.length > limit ? (page.at(-1)?.userId ?? null) : null,
      };
    },
  );

  app.patch(
    '/v1/orgs/:orgId/members/:userId',
    {
      onRequest: requireRole('owner'),
      schema: {
        operationId: 'updateMember',
        tags: ['members'],
        summary: 'Change a member’s role (owner)',
        description:
          'Owners may change any role, their own included, as long as the workspace keeps at ' +
          'least one owner; otherwise 409 `last_owner`.',
        params: MemberParams,
        headers: MutationHeaders,
        body: UpdateMemberRequest,
        response: { 200: Member, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId } = req.membership;
      const { userId } = req.params;
      await checkMembershipChange(req, userId, req.body.role);
      const before = await getMember(req.tx, orgId, userId);
      if (!before) throw new HttpProblem(404, 'not_found', 'Member not found.');
      await setMemberRole(req.tx, orgId, userId, req.body.role);
      const after = toMemberDto({ ...before, role: req.body.role });
      await req.audit('membership', userId, toMemberDto(before), after, { action: 'role.change' });
      return after;
    },
  );

  app.delete(
    '/v1/orgs/:orgId/members/:userId',
    {
      // Any member may remove themselves (leave); removing someone else needs the owner role.
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'removeMember',
        tags: ['members'],
        summary: 'Remove a member (owner), or leave the workspace (any member, own user id)',
        description:
          'The last owner cannot leave or be removed: 409 `last_owner`. Returns the removed member.',
        params: MemberParams,
        headers: MutationHeaders,
        response: { 200: Member, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId } = req.membership;
      const { userId } = req.params;
      await checkMembershipChange(req, userId, null);
      const before = await getMember(req.tx, orgId, userId);
      if (!before) throw new HttpProblem(404, 'not_found', 'Member not found.');
      await removeMember(req.tx, orgId, userId);
      const dto = toMemberDto(before);
      await req.audit('membership', userId, dto, null, {
        action: userId === req.user.id ? 'leave' : 'remove',
      });
      return dto;
    },
  );

  // ── Invitations (owner) ─────────────────────────────────────────────────────────────

  app.get(
    '/v1/orgs/:orgId/invitations',
    {
      onRequest: requireRole('owner'),
      schema: {
        operationId: 'listInvitations',
        tags: ['members'],
        summary: 'Pending invitations',
        params: OrgParams,
        response: { 200: InvitationList, default: problemResponse },
      },
    },
    async (req) => {
      const rows = await listPendingInvitations(app.db, req.membership.orgId);
      return { items: rows.map(toInvitationDto), nextCursor: null };
    },
  );

  app.post(
    '/v1/orgs/:orgId/invitations',
    {
      onRequest: requireRole('owner'),
      schema: {
        operationId: 'createInvitation',
        tags: ['members'],
        summary: 'Invite someone by email',
        description:
          'Emails a single-use link to `<web>/invite/<token>`, valid for 7 days. ' +
          'The token is never returned or stored in clear.',
        params: OrgParams,
        headers: MutationHeaders,
        body: CreateInvitationRequest,
        response: { 201: Invitation, default: problemResponse },
      },
    },
    async (req, reply) => {
      const { orgId } = req.membership;
      const email = normaliseEmail(req.body.email);
      if (await findMemberByEmail(req.tx, orgId, email)) {
        throw new HttpProblem(409, 'conflict', 'This person is already a member.');
      }
      if (await findPendingInvitationForEmail(req.tx, orgId, email)) {
        throw new HttpProblem(409, 'conflict', 'This email already has a pending invitation.');
      }
      const org = await getOrganizationForUser(req.tx, orgId, req.user.id);
      if (!org) throw new HttpProblem(404, 'not_found', 'Organization not found.');

      const token = randomBytes(32).toString('base64url');
      const invitation = await createInvitation(req.tx, orgId, {
        email,
        role: req.body.role,
        tokenHash: hashInvitationToken(token),
        invitedBy: req.user.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      });
      const dto = toInvitationDto(invitation);
      await req.audit('invitation', invitation.id, null, dto);
      // Sent inside the transaction: if mail fails, no invitation is left behind.
      await opts.mailer.send(
        invitationMail(email, org.name, req.body.role, `${opts.webOrigin}/invite/${token}`),
      );
      reply.code(201);
      return dto;
    },
  );

  app.post(
    '/v1/orgs/:orgId/invitations/:invitationId/revoke',
    {
      onRequest: requireRole('owner'),
      schema: {
        operationId: 'revokeInvitation',
        tags: ['members'],
        summary: 'Revoke a pending invitation',
        params: InvitationParams,
        headers: MutationHeaders,
        response: { 200: Invitation, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId } = req.membership;
      const current = await getInvitation(req.tx, orgId, req.params.invitationId);
      if (!current) throw new HttpProblem(404, 'not_found', 'Invitation not found.');
      const status = invitationStatus(current);
      if (status === 'accepted' || status === 'revoked') {
        throw new HttpProblem(409, 'conflict', NOT_PENDING_DETAIL[status]);
      }
      const revoked = await revokeInvitation(req.tx, orgId, current.id);
      const after = toInvitationDto(revoked);
      await req.audit('invitation', current.id, toInvitationDto(current), after, {
        action: 'revoke',
      });
      return after;
    },
  );

  app.post(
    '/v1/orgs/:orgId/invitations/:invitationId/resend',
    {
      onRequest: requireRole('owner'),
      schema: {
        operationId: 'resendInvitation',
        tags: ['members'],
        summary: 'Email a pending or expired invitation again',
        description: 'Makes a new link valid for 7 days from now; the previous link stops working.',
        params: InvitationParams,
        headers: MutationHeaders,
        response: { 200: Invitation, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId } = req.membership;
      const current = await getInvitation(req.tx, orgId, req.params.invitationId, {
        forUpdate: true,
      });
      if (!current) throw new HttpProblem(404, 'not_found', 'Invitation not found.');
      const status = invitationStatus(current);
      if (status === 'accepted' || status === 'revoked') {
        throw new HttpProblem(409, 'conflict', NOT_PENDING_DETAIL[status]);
      }
      if (await findMemberByEmail(req.tx, orgId, current.email)) {
        throw new HttpProblem(409, 'conflict', 'This person is already a member.');
      }
      const other = await findPendingInvitationForEmail(req.tx, orgId, current.email);
      if (other && other.id !== current.id) {
        throw new HttpProblem(
          409,
          'conflict',
          'This email already has a newer pending invitation.',
        );
      }
      const org = await getOrganizationForUser(req.tx, orgId, req.user.id);
      if (!org) throw new HttpProblem(404, 'not_found', 'Organization not found.');

      const token = randomBytes(32).toString('base64url');
      const renewed = await renewInvitation(req.tx, orgId, current.id, {
        tokenHash: hashInvitationToken(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      });
      const after = toInvitationDto(renewed);
      await req.audit('invitation', current.id, toInvitationDto(current), after, {
        action: 'resend',
      });
      await opts.mailer.send(
        invitationMail(current.email, org.name, current.role, `${opts.webOrigin}/invite/${token}`),
      );
      return after;
    },
  );

  // ── Invitee side (no membership yet) ────────────────────────────────────────────────

  app.post(
    '/v1/invitations/preview',
    {
      // Read-only: shows the invite page what the token is for. The token is in the body so it
      // never appears in access logs.
      config: { tx: false },
      schema: {
        operationId: 'previewInvitation',
        tags: ['members'],
        summary: 'What an invitation token is for',
        body: InvitationTokenRequest,
        response: { 200: InvitationPreview, default: problemResponse },
      },
    },
    async (req) => {
      const inv = await findInvitationByTokenHash(app.db, hashInvitationToken(req.body.token));
      if (!inv) throw new HttpProblem(404, 'not_found', 'Invitation not found.');
      return {
        orgName: inv.orgName,
        email: inv.email,
        role: inv.role,
        status: invitationStatus(inv),
        expiresAt: inv.expiresAt.toISOString(),
      };
    },
  );

  app.post(
    '/v1/invitations/accept',
    {
      onRequest: requireAuth(),
      schema: {
        operationId: 'acceptInvitation',
        tags: ['members'],
        summary: 'Accept an invitation as the signed-in user',
        description: 'The signed-in email must match the invited email.',
        headers: MutationHeaders,
        body: InvitationTokenRequest,
        response: { 200: AcceptInvitationResponse, default: problemResponse },
      },
    },
    async (req) => {
      const inv = await findInvitationByTokenHash(req.tx, hashInvitationToken(req.body.token), {
        forUpdate: true,
      });
      if (!inv) throw new HttpProblem(404, 'not_found', 'Invitation not found.');
      const status = invitationStatus(inv);
      if (status !== 'pending') throw new HttpProblem(409, 'conflict', NOT_PENDING_DETAIL[status]);
      if (normaliseEmail(req.user.email) !== inv.email) {
        throw new HttpProblem(
          403,
          'forbidden',
          'This invitation was sent to a different email address.',
        );
      }
      if (await getMembership(req.tx, inv.orgId, req.user.id)) {
        throw new HttpProblem(409, 'conflict', 'You are already a member of this organization.');
      }
      const membership = await addMember(req.tx, inv.orgId, req.user.id, inv.role);
      await markInvitationAccepted(req.tx, inv.orgId, inv.id);
      await req.audit(
        'membership',
        req.user.id,
        null,
        { ...membership, invitationId: inv.id },
        { orgId: inv.orgId, action: 'invitation.accept' },
      );
      return { orgId: inv.orgId, orgName: inv.orgName, role: inv.role };
    },
  );
};
