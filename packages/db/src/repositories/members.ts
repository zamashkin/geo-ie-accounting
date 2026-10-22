import type { Role } from '@geo-ie-accounting/contracts';
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

/** The member of the org with this email, if any (emails compared lower-cased). */
export async function findMemberByEmail(
  db: DbOrTx,
  orgId: string,
  email: string,
): Promise<MemberRow | null> {
  const [row] = await db
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
      and(eq(memberships.orgId, orgId), eq(sql`lower(${users.email})`, normaliseEmail(email))),
    );
  return row ?? null;
}

/** One member of the org with their name and email, or null. */
export async function getMember(
  db: DbOrTx,
  orgId: string,
  userId: string,
): Promise<MemberRow | null> {
  const [row] = await db
    .select({
      userId: memberships.userId,
      email: users.email,
      name: users.name,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return row ?? null;
}

/**
 * Locks every membership row of the org (in user id order, so concurrent callers queue instead
 * of deadlocking) and returns them. Role changes and removals take this lock first, so the
 * "at least one owner" check and the write see the same membership set.
 */
export async function lockOrgMemberships(
  tx: DbOrTx,
  orgId: string,
): Promise<Pick<MembershipRow, 'userId' | 'role'>[]> {
  return tx
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.orgId, orgId))
    .orderBy(asc(memberships.userId))
    .for('update');
}

export async function setMemberRole(
  db: DbOrTx,
  orgId: string,
  userId: string,
  role: Role,
): Promise<MembershipRow> {
  const [row] = await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .returning();
  if (!row) throw new Error('membership to update not found');
  return row;
}

export async function removeMember(db: DbOrTx, orgId: string, userId: string): Promise<void> {
  await db
    .delete(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
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
  opts: { forUpdate?: boolean } = {},
): Promise<InvitationRow | null> {
  const query = db
    .select()
    .from(invitations)
    .where(and(eq(invitations.orgId, orgId), eq(invitations.id, invitationId)));
  const [row] = opts.forUpdate ? await query.for('update') : await query;
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

/** A new token and expiry for a pending or expired invitation (resend). The old link stops working. */
export async function renewInvitation(
  db: DbOrTx,
  orgId: string,
  invitationId: string,
  input: { tokenHash: string; expiresAt: Date },
): Promise<InvitationRow> {
  const [row] = await db
    .update(invitations)
    .set(input)
    .where(and(eq(invitations.orgId, orgId), eq(invitations.id, invitationId)))
    .returning();
  if (!row) throw new Error('invitation to renew not found');
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
