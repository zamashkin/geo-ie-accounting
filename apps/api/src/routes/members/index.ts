import { createHash, randomBytes } from 'node:crypto';
import {
  AcceptInvitationResponse,
  CreateInvitationRequest,
  Invitation,
  InvitationList,
  InvitationParams,
  InvitationPreview,
  InvitationTokenRequest,
  MemberList,
  MutationHeaders,
  OrgParams,
  PaginationQuery,
  Uuid,
  type InvitationStatus,
} from '@ie-ledger/contracts';
import {
  addMember,
  createInvitation,
  findInvitationByTokenHash,
  findMemberByEmail,
  findPendingInvitationForEmail,
  getInvitation,
  getMembership,
  getOrganizationForUser,
  listMembers,
  listPendingInvitations,
  markInvitationAccepted,
  normaliseEmail,
  revokeInvitation,
  type InvitationRow,
} from '@ie-ledger/db';
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
        items: page.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
        nextCursor: rows.length > limit ? (page.at(-1)?.userId ?? null) : null,
      };
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
