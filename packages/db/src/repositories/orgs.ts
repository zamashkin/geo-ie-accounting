import type { Role } from '@ie-ledger/contracts';
import { and, asc, eq, gt } from 'drizzle-orm';
import { seedChartOfAccounts } from '../chart-of-accounts';
import type { DbOrTx, Tx } from '../client';
import { memberships, organizations } from '../schema/index';

export type OrganizationRow = typeof organizations.$inferSelect;
export type OrganizationWithRole = OrganizationRow & { role: Role };

export interface NewOrganization {
  name: string;
  taxId?: string | null | undefined;
  sbsEffectiveFrom?: string | null | undefined;
}

/**
 * Creates an organisation, makes `ownerId` its owner and seeds the default chart of accounts.
 * Takes a transaction: the three inserts succeed or fail together.
 */
export async function createOrganization(
  tx: Tx,
  ownerId: string,
  input: NewOrganization,
): Promise<OrganizationRow> {
  const [org] = await tx
    .insert(organizations)
    .values({
      name: input.name,
      taxId: input.taxId ?? null,
      sbsEffectiveFrom: input.sbsEffectiveFrom ?? null,
    })
    .returning();
  if (!org) throw new Error('organization insert returned no row');
  await tx.insert(memberships).values({ orgId: org.id, userId: ownerId, role: 'owner' });
  await seedChartOfAccounts(tx, org.id);
  return org;
}

/** Organisations the user is a member of, oldest first. `cursor` is the last org id seen. */
export async function listOrganizationsForUser(
  db: DbOrTx,
  userId: string,
  page: { cursor?: string | undefined; limit: number },
): Promise<OrganizationWithRole[]> {
  const rows = await db
    .select({ org: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(
      and(
        eq(memberships.userId, userId),
        page.cursor === undefined ? undefined : gt(organizations.id, page.cursor),
      ),
    )
    .orderBy(asc(organizations.id))
    .limit(page.limit);
  return rows.map((r) => ({ ...r.org, role: r.role }));
}

/** The organisation with the caller's role, or null when the user is not a member. */
export async function getOrganizationForUser(
  db: DbOrTx,
  orgId: string,
  userId: string,
): Promise<OrganizationWithRole | null> {
  const [row] = await db
    .select({ org: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return row ? { ...row.org, role: row.role } : null;
}
