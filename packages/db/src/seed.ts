import { readFileSync } from 'node:fs';
import { hashPassword } from '@better-auth/utils/password';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { seedChartOfAccounts } from './chart-of-accounts';
import type { Db } from './client';
import { upsertRates, type NewExchangeRate, type UpsertRatesResult } from './repositories/rates';
import { authAccounts, memberships, organizations, users } from './schema/index';

/**
 * The local development login (`pnpm db:seed`): owner of an empty workspace. Fixed ids so the
 * seed is idempotent and tests can refer to it. The public, read-only demo is a different login
 * (`pnpm db:seed:demo`, apps/api/src/demo).
 */
export const DEV = {
  userId: '01900000-0000-7000-8000-000000000011',
  userEmail: 'dev@geo-ie-accounting.local',
  userName: 'Dev Entrepreneur',
  /** Local development only: sign in with this email and password. */
  password: 'dev-password-2026',
  orgId: '01900000-0000-7000-8000-000000000012',
  orgName: 'Dev IE',
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
export async function seedDev(db: Db): Promise<SeedResult> {
  const passwordHash = await hashPassword(DEV.password);
  return db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: DEV.userId, email: DEV.userEmail, name: DEV.userName, emailVerified: true })
      .onConflictDoNothing({ target: users.email });
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, DEV.userEmail));
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
      .values({ id: DEV.orgId, name: DEV.orgName, sbsEffectiveFrom: DEV.sbsEffectiveFrom })
      .onConflictDoNothing({ target: organizations.id })
      .returning({ id: organizations.id });

    let accountCount = 0;
    if (inserted.length > 0) {
      await tx.insert(memberships).values({ orgId: DEV.orgId, userId: user.id, role: 'owner' });
      accountCount = (await seedChartOfAccounts(tx, DEV.orgId)).length;
    }
    return {
      userId: user.id,
      orgId: DEV.orgId,
      createdOrg: inserted.length > 0,
      createdLogin: !credential,
      accounts: accountCount,
    };
  });
}

// ── Offline NBG rates ───────────────────────────────────────────────────────────────────

/**
 * Recorded NBG responses (fixtures/nbg/) for the dates the BoG statement fixture books on, so
 * the MVP import path (docs/MVP.md) works without network: 04.06 and 11.06 (incoming payments) and 05.06 (the
 * conversions). See fixtures/nbg/README.md.
 */
export const DEV_RATE_FIXTURES = [
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

/** Stores the BoG fixture's NBG rates. Idempotent: existing rows are kept (see `upsertRates`). */
export async function seedDevRates(db: Db): Promise<UpsertRatesResult> {
  return upsertRates(db, DEV_RATE_FIXTURES.flatMap(readRateFixture));
}
