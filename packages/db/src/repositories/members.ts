import type { Role } from '@ie-ledger/contracts';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import { invitations, memberships, organizations, users } from '../schema/index';

export type MembershipRow = typeof memberships.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;

export interface MemberRow {
  userId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
}

// ── Memberships ─────────────────────────────────────────────────────────────────────────

/** The user's membership in the org, or null. Used by the authorization hook on every tenant route. */
export async function getMembership(
  db: DbOrTx,
  orgId: string,
  userId: string,
): Promise<MembershipRow | null> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return row ?? null;
}

/** Members of an org ordered by user id. `cursor` is the last user id seen. */
export async function listMembers(
  db: DbOrTx,
  orgId: string,
  page: { cursor?: string | undefined; limit: number },
): Promise<MemberRow[]> {
  return db
    .select({
      userId: memberships.userId,
      email: users.email,
      name: users.name,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        page.cursor === undefined ? undefined : gt(memberships.userId, page.cursor),
      ),
    )
    .orderBy(asc(memberships.userId))
    .limit(page.limit);
}

export async function addMember(
  db: DbOrTx,
  orgId: string,
  userId: string,
  role: Role,
): Promise<MembershipRow> {
  const [row] = await db.insert(memberships).values({ orgId, userId, role }).returning();
  if (!row) throw new Error('membership insert returned no row');
  return row;
}

// ── Invitations ─────────────────────────────────────────────────────────────────────────

/** Emails are compared case-insensitively; invitations store them lower-cased. */
export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export interface NewInvitation {
  email: string;
  role: Role;
  tokenHash: string;
  invitedBy: string;
  expiresAt: Date;
}

export async function createInvitation(
  db: DbOrTx,
  orgId: string,
  input: NewInvitation,
): Promise<InvitationRow> {
  const [row] = await db
    .insert(invitations)
    .values({ ...input, orgId, email: normaliseEmail(input.email) })
    .returning();
  if (!row) throw new Error('invitation insert returned no row');
  return row;
}

/** Open invitations: not accepted, not revoked, not expired. Newest first. */
export async function listPendingInvitations(
  db: DbOrTx,
  orgId: string,
  now: Date = new Date(),
): Promise<InvitationRow[]> {
  return db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.orgId, orgId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, now),
      ),
    )
    .orderBy(sql`${invitations.createdAt} desc`);
}

export async function findPendingInvitationForEmail(
  db: DbOrTx,
  orgId: string,
  email: string,
  now: Date = new Date(),
): Promise<InvitationRow | null> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.orgId, orgId),
        eq(invitations.email, normaliseEmail(email)),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getInvitation(
  db: DbOrTx,
  orgId: string,
  invitationId: string,
): Promise<InvitationRow | null> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.orgId, orgId), eq(invitations.id, invitationId)));
  return row ?? null;
}

/**
 * Looks an invitation up by the sha256 of its token, across orgs: the invitee is not a member
 * yet, so the token is the only thing that identifies the org. `forUpdate` locks the row so two
 * concurrent accepts cannot both succeed.
 */
export async function findInvitationByTokenHash(
  db: DbOrTx,
  tokenHash: string,
  opts: { forUpdate?: boolean } = {},
): Promise<(InvitationRow & { orgName: string }) | null> {
  const query = db
    .select({ invitation: invitations, orgName: organizations.name })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .where(eq(invitations.tokenHash, tokenHash));
  const [row] = opts.forUpdate ? await query.for('update', { of: invitations }) : await query;
  return row ? { ...row.invitation, orgName: row.orgName } : null;
}

export async function markInvitationAccepted(
  db: DbOrTx,
  orgId: string,
  invitationId: string,
  at: Date = new Date(),
): Promise<InvitationRow> {
  const [row] = await db
    .update(invitations)
    .set({ acceptedAt: at })
    .where(and(eq(invitations.orgId, orgId), eq(invitations.id, invitationId)))
    .returning();
  if (!row) throw new Error('invitation to accept not found');
  return row;
}

export async function revokeInvitation(
  db: DbOrTx,
  orgId: string,
  invitationId: string,
  at: Date = new Date(),
): Promise<InvitationRow> {
  const [row] = await db
    .update(invitations)
    .set({ revokedAt: at })
    .where(and(eq(invitations.orgId, orgId), eq(invitations.id, invitationId)))
    .returning();
  if (!row) throw new Error('invitation to revoke not found');
  return row;
}
