import { verifyPassword } from '@better-auth/utils/password';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../chart-of-accounts';
import { accounts, authAccounts, idempotencyKeys, users } from '../schema/index';
import { DEMO, seedDemo } from '../seed';
import { startTestDatabase, type TestDatabase } from '../testing/index';
import { insertAuditEntry, listAuditEntries } from './audit';
import { claimIdempotencyKey, completeIdempotencyKey, IDEMPOTENCY_TTL_MS } from './idempotency';
import {
  createInvitation,
  findInvitationByTokenHash,
  findPendingInvitationForEmail,
  getMembership,
  listMembers,
} from './members';
import { createOrganization, getOrganizationForUser, listOrganizationsForUser } from './orgs';

let tdb: TestDatabase;

async function makeUser(email = `${uuidv7()}@example.test`) {
  const [u] = await tdb.db.insert(users).values({ email, name: 'Test' }).returning();
  return u!;
}

beforeAll(async () => {
  tdb = await startTestDatabase();
});

afterAll(async () => {
  await (tdb as TestDatabase | undefined)?.close();
});

describe('seedDemo', () => {
  it('creates a credential login once, with a hash Better Auth can verify', async () => {
    const first = await seedDemo(tdb.db);
    const second = await seedDemo(tdb.db);
    expect(first.createdLogin).toBe(true);
    expect(second.createdLogin).toBe(false);
    const creds = await tdb.db
      .select()
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, DEMO.userId), eq(authAccounts.providerId, 'credential')));
    expect(creds).toHaveLength(1);
    expect(creds[0]!.accountId).toBe(DEMO.userId);
    expect(await verifyPassword(creds[0]!.password!, DEMO.password)).toBe(true);
  });
});

describe('organisations and members', () => {
  it('creates an org with an owner membership and the default chart of accounts', async () => {
    const user = await makeUser();
    const org = await tdb.db.transaction((tx) =>
      createOrganization(tx, user.id, { name: 'Acme IE', sbsEffectiveFrom: '2026-01-15' }),
    );
    expect(await getMembership(tdb.db, org.id, user.id)).toMatchObject({ role: 'owner' });
    const coa = await tdb.db.select().from(accounts).where(eq(accounts.orgId, org.id));
    expect(coa).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    expect(await getOrganizationForUser(tdb.db, org.id, user.id)).toMatchObject({
      name: 'Acme IE',
      role: 'owner',
    });
    const other = await makeUser();
    expect(await getOrganizationForUser(tdb.db, org.id, other.id)).toBeNull();
  });

  it('pages a user’s orgs and an org’s members by cursor', async () => {
    const user = await makeUser();
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C']) {
      ids.push((await tdb.db.transaction((tx) => createOrganization(tx, user.id, { name }))).id);
    }
    const page1 = await listOrganizationsForUser(tdb.db, user.id, { limit: 2 });
    const page2 = await listOrganizationsForUser(tdb.db, user.id, {
      limit: 2,
      cursor: page1.at(-1)!.id,
    });
    expect([...page1, ...page2].map((o) => o.id)).toEqual(ids);
    const members = await listMembers(tdb.db, ids[0]!, { limit: 10 });
    expect(members).toEqual([expect.objectContaining({ userId: user.id, role: 'owner' })]);
  });

  it('finds invitations by token hash and pending ones by email, case-insensitively', async () => {
    const owner = await makeUser();
    const org = await tdb.db.transaction((tx) => createOrganization(tx, owner.id, { name: 'X' }));
    const tokenHash = uuidv7();
    await createInvitation(tdb.db, org.id, {
      email: 'Invitee@Example.TEST',
      role: 'viewer',
      tokenHash,
      invitedBy: owner.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await findInvitationByTokenHash(tdb.db, tokenHash)).toMatchObject({
      email: 'invitee@example.test',
      orgName: 'X',
    });
    expect(
      await findPendingInvitationForEmail(tdb.db, org.id, 'INVITEE@example.test'),
    ).not.toBeNull();
    // After expiry it no longer counts as pending.
    expect(
      await findPendingInvitationForEmail(
        tdb.db,
        org.id,
        'invitee@example.test',
        new Date(Date.now() + 120_000),
      ),
    ).toBeNull();
  });

  it('writes and lists audit entries per org', async () => {
    const owner = await makeUser();
    const org = await tdb.db.transaction((tx) => createOrganization(tx, owner.id, { name: 'Y' }));
    await insertAuditEntry(tdb.db, org.id, {
      actorId: owner.id,
      action: 'create',
      entity: 'organization',
      entityId: org.id,
      before: null,
      after: { name: 'Y' },
      requestId: 'req-1',
    });
    const rows = await listAuditEntries(tdb.db, org.id, { entity: 'organization' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: owner.id, requestId: 'req-1' });
  });
});

describe('idempotency keys', () => {
  it('claims a key once and returns the stored record afterwards', async () => {
    const user = await makeUser();
    const scope = { orgId: null, userId: user.id, key: 'k-1' };
    const first = await tdb.db.transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, scope, 'hash-a');
      await completeIdempotencyKey(tx, scope, 201, { ok: true });
      return claim;
    });
    expect(first.status).toBe('claimed');
    const second = await tdb.db.transaction((tx) => claimIdempotencyKey(tx, scope, 'hash-a'));
    expect(second).toMatchObject({
      status: 'existing',
      record: { requestHash: 'hash-a', statusCode: 201, response: { ok: true } },
    });
  });

  it('scopes keys by org and user', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const org = await tdb.db.transaction((tx) => createOrganization(tx, a.id, { name: 'Z' }));
    for (const scope of [
      { orgId: null, userId: a.id, key: 'same' },
      { orgId: org.id, userId: a.id, key: 'same' },
      { orgId: org.id, userId: b.id, key: 'same' },
    ]) {
      const claim = await tdb.db.transaction((tx) => claimIdempotencyKey(tx, scope, 'h'));
      expect(claim.status).toBe('claimed');
    }
  });

  it('frees the key when the claiming transaction rolls back', async () => {
    const user = await makeUser();
    const scope = { orgId: null, userId: user.id, key: 'rollback' };
    await expect(
      tdb.db.transaction(async (tx) => {
        await claimIdempotencyKey(tx, scope, 'h');
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    const claim = await tdb.db.transaction((tx) => claimIdempotencyKey(tx, scope, 'h'));
    expect(claim.status).toBe('claimed');
  });

  it('makes a concurrent claim wait for the first transaction and then see its response', async () => {
    const user = await makeUser();
    const scope = { orgId: null, userId: user.id, key: 'race' };
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let claimedFirst!: () => void;
    const firstClaimed = new Promise<void>((r) => (claimedFirst = r));

    const first = tdb.db.transaction(async (tx) => {
      await claimIdempotencyKey(tx, scope, 'h');
      claimedFirst();
      await held;
      await completeIdempotencyKey(tx, scope, 201, { n: 1 });
    });
    await firstClaimed;
    const second = tdb.db.transaction((tx) => claimIdempotencyKey(tx, scope, 'h'));
    // Give the second claim time to block on the unique index.
    await new Promise((r) => setTimeout(r, 100));
    release();
    await first;
    expect(await second).toMatchObject({ status: 'existing', record: { statusCode: 201 } });
  });

  it('treats an expired key as unused', async () => {
    const user = await makeUser();
    const scope = { orgId: null, userId: user.id, key: 'old' };
    await tdb.db.insert(idempotencyKeys).values({
      ...scope,
      requestHash: 'old-hash',
      statusCode: 200,
      response: {},
      createdAt: new Date(Date.now() - IDEMPOTENCY_TTL_MS - 1000),
    });
    const claim = await tdb.db.transaction((tx) => claimIdempotencyKey(tx, scope, 'new-hash'));
    expect(claim.status).toBe('claimed');
  });
});
