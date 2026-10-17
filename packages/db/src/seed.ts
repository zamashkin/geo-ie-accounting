import { readFileSync } from 'node:fs';
import { hashPassword } from '@better-auth/utils/password';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { seedChartOfAccounts } from './chart-of-accounts';
import type { Db } from './client';
import { upsertRates, type NewExchangeRate, type UpsertRatesResult } from './repositories/rates';
import { authAccounts, memberships, organizations, users } from './schema/index';

/** Fixed ids so the seed is idempotent and tests/docs can refer to the demo org. */
export const DEMO = {
  userId: '01900000-0000-7000-8000-000000000001',
  userEmail: 'demo@geo-ie-accounting.local',
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

// ── Offline NBG rates ───────────────────────────────────────────────────────────────────

/**
 * Recorded NBG responses (fixtures/nbg/) for the dates the BoG statement fixture books on, so
 * the demo import works without network: 04.06 and 11.06 (incoming payments) and 05.06 (the
 * conversions). See fixtures/nbg/README.md.
 */
export const DEMO_RATE_FIXTURES = [
  'GBP_2025-06-04.json',
  'GBP_2025-06-05.json',
  'GBP_2025-06-11.json',
] as const;

const NBG_FIXTURES_DIR = new URL('../../../fixtures/nbg/', import.meta.url);

// Only the fields the seed needs. The full parser lives in packages/nbg, which db may not import.
const FixtureBody = z.array(
  z.object({
    currencies: z.array(
      z.object({
        code: z.string().regex(/^[A-Z]{3}$/),
        quantity: z.int().positive(),
        rateFormated: z.string().regex(/^[0-9]+(\.[0-9]{1,6})?$/),
        validFromDate: z.string(),
        date: z.string(),
      }),
    ),
  }),
);

/** NBG writes Tbilisi wall-clock time with a `Z` suffix (fixtures/nbg/README.md). */
const tbilisiWallClockToUtc = (s: string) => new Date(s.replace(/Z$/, '+04:00'));

export function readRateFixture(name: string): NewExchangeRate[] {
  const body = FixtureBody.parse(
    JSON.parse(readFileSync(new URL(name, NBG_FIXTURES_DIR), 'utf8')) as unknown,
  );
  return body.flatMap((group) =>
    group.currencies.map((c) => ({
      currency: c.code,
      validFrom: c.validFromDate.slice(0, 10),
      rate: c.rateFormated,
      quantity: c.quantity,
      setAt: tbilisiWallClockToUtc(c.date),
    })),
  );
}

/** Stores the demo's NBG rates. Idempotent: existing rows are kept (see `upsertRates`). */
export async function seedDemoRates(db: Db): Promise<UpsertRatesResult> {
  return upsertRates(db, DEMO_RATE_FIXTURES.flatMap(readRateFixture));
}
