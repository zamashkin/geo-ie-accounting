// Logins and workspaces of the public demo (`pnpm db:seed:demo`, ADR 0016). Not tenant data
// queries: these look across orgs by the `demo_seed` marker, so only the seed script and the
// read-only guard use them.
import { hashPassword } from '@better-auth/utils/password';
import type { Role } from '@geo-ie-accounting/contracts';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db, DbOrTx } from '../client';
import { authAccounts, memberships, organizations, users } from '../schema/index';
import { normaliseEmail } from './members';

/** True when `email` belongs to a read-only (demo) login. */
export async function isReadOnlyEmail(db: DbOrTx, email: string): Promise<boolean> {
  const [row] = await db
    .select({ readOnly: users.readOnly })
    .from(users)
    .where(eq(users.email, normaliseEmail(email)));
  return row?.readOnly ?? false;
}

export interface PasswordLogin {
  email: string;
  name: string;
  password: string;
  readOnly: boolean;
}

/**
 * Creates or updates a verified email+password login, the way Better Auth stores one (a
 * `credential` account whose accountId is the user id, scrypt hash from `@better-auth/utils`).
 * An existing user keeps its id; its name, read-only flag and password are reset.
 */
export async function upsertPasswordLogin(db: Db, login: PasswordLogin): Promise<string> {
  const email = normaliseEmail(login.email);
  const passwordHash = await hashPassword(login.password);
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email, name: login.name, emailVerified: true, readOnly: login.readOnly })
      .onConflictDoUpdate({
        target: users.email,
        set: { name: login.name, emailVerified: true, readOnly: login.readOnly },
      })
      .returning({ id: users.id });
    if (!user) throw new Error('user upsert returned no row');
    const updated = await tx
      .update(authAccounts)
      .set({ password: passwordHash })
      .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, 'credential')))
      .returning({ id: authAccounts.id });
    if (updated.length === 0) {
      await tx.insert(authAccounts).values({
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: passwordHash,
      });
    }
    return user.id;
  });
}

export interface DemoOrganization {
  id: string;
  name: string;
  demoSeed: string;
}

/** Workspaces the demo seed made that still have members. */
export async function listDemoOrganizations(db: DbOrTx): Promise<DemoOrganization[]> {
  const rows = await db
    .selectDistinct({
      id: organizations.id,
      name: organizations.name,
      demoSeed: organizations.demoSeed,
    })
    .from(organizations)
    .innerJoin(memberships, eq(memberships.orgId, organizations.id))
    .where(isNotNull(organizations.demoSeed));
  return rows.flatMap((r) => (r.demoSeed === null ? [] : [{ ...r, demoSeed: r.demoSeed }]));
}

/** Marks a workspace as made by the demo seed (see `organizations.demo_seed`). */
export async function markDemoOrganization(db: DbOrTx, orgId: string, demoSeed: string) {
  await db.update(organizations).set({ demoSeed }).where(eq(organizations.id, orgId));
}

/**
 * Retires a demo workspace: removes every membership so nobody can open it again. The ledger
 * is insert-only (postings, transactions and filings cannot be deleted), so the rows stay.
 */
export async function retireDemoOrganization(db: DbOrTx, orgId: string, retiredName: string) {
  await db.delete(memberships).where(eq(memberships.orgId, orgId));
  await db.update(organizations).set({ name: retiredName }).where(eq(organizations.id, orgId));
}

/** Adds `userId` to the org with `role`, or changes the role of an existing membership. */
export async function setMembership(db: DbOrTx, orgId: string, userId: string, role: Role) {
  await db
    .insert(memberships)
    .values({ orgId, userId, role })
    .onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { role } });
}

/** Removes every membership of `userId` outside `keepOrgIds`. */
export async function removeOtherMemberships(
  db: DbOrTx,
  userId: string,
  keepOrgIds: readonly string[],
) {
  const rows = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  for (const { orgId } of rows) {
    if (keepOrgIds.includes(orgId)) continue;
    await db
      .delete(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  }
}
