import { eq } from 'drizzle-orm';
import { seedChartOfAccounts } from './chart-of-accounts';
import type { Db } from './client';
import { memberships, organizations, users } from './schema/index';

/** Fixed ids so the seed is idempotent and tests/docs can refer to the demo org. */
export const DEMO = {
  userId: '01900000-0000-7000-8000-000000000001',
  userEmail: 'demo@ie-ledger.local',
  userName: 'Demo Entrepreneur',
  orgId: '01900000-0000-7000-8000-000000000002',
  orgName: 'Demo IE',
  sbsEffectiveFrom: '2025-01-01',
} as const;

export interface SeedResult {
  userId: string;
  orgId: string;
  createdOrg: boolean;
  accounts: number;
}

/**
 * One user, one org (owner membership) and the default chart of accounts. Safe to re-run.
 * Login credentials are not created here: Better Auth hashes passwords, so WS-05 adds the
 * demo login through its own API.
 */
export async function seedDemo(db: Db): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: DEMO.userId, email: DEMO.userEmail, name: DEMO.userName, emailVerified: true })
      .onConflictDoNothing({ target: users.email });
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, DEMO.userEmail));
    if (!user) throw new Error('Seed user missing after insert');

    const inserted = await tx
      .insert(organizations)
      .values({ id: DEMO.orgId, name: DEMO.orgName, sbsEffectiveFrom: DEMO.sbsEffectiveFrom })
      .onConflictDoNothing({ target: organizations.id })
      .returning({ id: organizations.id });

    let accountCount = 0;
    if (inserted.length > 0) {
      await tx.insert(memberships).values({ orgId: DEMO.orgId, userId: user.id, role: 'owner' });
      accountCount = (await seedChartOfAccounts(tx, DEMO.orgId)).length;
    }
    return {
      userId: user.id,
      orgId: DEMO.orgId,
      createdOrg: inserted.length > 0,
      accounts: accountCount,
    };
  });
}
