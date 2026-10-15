import { hashPassword } from '@better-auth/utils/password';
import { and, eq } from 'drizzle-orm';
import { seedChartOfAccounts } from './chart-of-accounts';
import type { Db } from './client';
import { authAccounts, memberships, organizations, users } from './schema/index';

/** Fixed ids so the seed is idempotent and tests/docs can refer to the demo org. */
export const DEMO = {
  userId: '01900000-0000-7000-8000-000000000001',
  userEmail: 'demo@ie-ledger.local',
  userName: 'Demo Entrepreneur',
  /** Local development only: sign in with this email and password. */
  password: 'demo-password-2026',
  orgId: '01900000-0000-7000-8000-000000000002',
  orgName: 'Demo IE',
  sbsEffectiveFrom: '2025-01-01',
} as const;

export interface SeedResult {
  userId: string;
  orgId: string;
  createdOrg: boolean;
  createdLogin: boolean;
  accounts: number;
}

/**
 * One user with an email+password login, one org (owner membership) and the default chart of
 * accounts. Safe to re-run: existing rows are left alone.
 *
 * The login is a Better Auth `credential` account: accountId = user id and a scrypt hash made by
 * the same `@better-auth/utils` version Better Auth verifies with.
 */
export async function seedDemo(db: Db): Promise<SeedResult> {
  const passwordHash = await hashPassword(DEMO.password);
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

    const [credential] = await tx
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, 'credential')));
    if (!credential) {
      await tx.insert(authAccounts).values({
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: passwordHash,
      });
    }

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
      createdLogin: !credential,
      accounts: accountCount,
    };
  });
}
