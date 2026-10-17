import { DEFAULT_CHART_OF_ACCOUNTS, listAuditEntries, schema } from '@geo-ie-accounting/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMemberViaInvite,
  as,
  createOrg,
  invitationToken,
  signUp,
  startApiTestEnv,
  type ApiTestEnv,
  type TestUser,
} from '../../testing/env';

let env: ApiTestEnv;
let owner: TestUser;
let accountant: TestUser;
let viewer: TestUser;
let orgId: string;

beforeAll(async () => {
  env = await startApiTestEnv();
  [owner, accountant, viewer] = await Promise.all([signUp(env), signUp(env), signUp(env)]);
  orgId = await createOrg(env, owner, 'Roles IE');
  await addMemberViaInvite(env, orgId, owner, accountant, 'accountant');
  await addMemberViaInvite(env, orgId, owner, viewer, 'viewer');
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

describe('POST /v1/orgs', () => {
  it('creates the org, makes the caller owner, seeds accounts and audits it', async () => {
    const user = await signUp(env);
    const res = await as(env, user, {
      method: 'POST',
      url: '/v1/orgs',
      payload: { name: '  Gela Beridze IE ', taxId: '01001012345', sbsEffectiveFrom: '2026-03-14' },
    });
    expect(res.statusCode).toBe(201);
    const org = res.json<{ id: string }>();
    expect(org).toMatchObject({
      name: 'Gela Beridze IE',
      taxId: '01001012345',
      sbsEffectiveFrom: '2026-03-14',
      baseCurrency: 'GEL',
      accountingMethod: 'cash',
      role: 'owner',
    });
    const accounts = await env.tdb.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.orgId, org.id));
    expect(accounts).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    const audit = await listAuditEntries(env.tdb.db, org.id);
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'create',
        entity: 'organization',
        entityId: org.id,
        actorId: user.id,
        requestId: res.headers['x-request-id'],
      }),
    ]);
  });

  it('validates the body', async () => {
    const res = await as(env, owner, { method: 'POST', url: '/v1/orgs', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation_failed' });
  });
});

describe('GET /v1/orgs and /v1/orgs/:orgId', () => {
  it('lists only the caller’s orgs, with their role, paginated', async () => {
    const user = await signUp(env);
    const a = await createOrg(env, user, 'A');
    const b = await createOrg(env, user, 'B');
    const page1 = await as(env, user, { method: 'GET', url: '/v1/orgs?limit=1' });
    expect(page1.json()).toMatchObject({ items: [{ id: a, role: 'owner' }] });
    const cursor = page1.json<{ nextCursor: string }>().nextCursor;
    expect(cursor).toBe(a);
    const page2 = await as(env, user, { method: 'GET', url: `/v1/orgs?limit=1&cursor=${cursor}` });
    expect(page2.json()).toEqual({ items: [expect.objectContaining({ id: b })], nextCursor: null });
    const bad = await as(env, user, { method: 'GET', url: '/v1/orgs?cursor=nope' });
    expect(bad.statusCode).toBe(400);
  });

  it('returns the org with the caller’s role for every member', async () => {
    for (const [user, role] of [
      [owner, 'owner'],
      [accountant, 'accountant'],
      [viewer, 'viewer'],
    ] as const) {
      const res = await as(env, user, { method: 'GET', url: `/v1/orgs/${orgId}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: orgId, role });
    }
  });

  it('answers 404 for a malformed or unknown org id', async () => {
    for (const id of ['not-a-uuid', '01900000-0000-7000-8000-00000000dead']) {
      const res = await as(env, owner, { method: 'GET', url: `/v1/orgs/${id}` });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('role boundaries', () => {
  const cases: {
    name: string;
    request: () => { method: 'GET' | 'POST'; url: string; payload?: object };
    allowed: ('owner' | 'accountant' | 'viewer')[];
  }[] = [
    {
      name: 'GET members',
      request: () => ({ method: 'GET', url: `/v1/orgs/${orgId}/members` }),
      allowed: ['owner', 'accountant', 'viewer'],
    },
    {
      name: 'GET invitations',
      request: () => ({ method: 'GET', url: `/v1/orgs/${orgId}/invitations` }),
      allowed: ['owner'],
    },
    {
      name: 'POST invitations',
      request: () => ({
        method: 'POST',
        url: `/v1/orgs/${orgId}/invitations`,
        payload: {
          email: `boundary-${Math.random().toString(36).slice(2)}@example.test`,
          role: 'viewer',
        },
      }),
      allowed: ['owner'],
    },
    {
      name: 'POST revoke',
      request: () => ({
        method: 'POST',
        url: `/v1/orgs/${orgId}/invitations/01900000-0000-7000-8000-00000000beef/revoke`,
      }),
      // The owner passes the guard and gets 404 for the unknown invitation.
      allowed: ['owner'],
    },
  ];

  for (const c of cases) {
    it(`${c.name}: allowed for ${c.allowed.join(', ')}, 403 otherwise`, async () => {
      const users = { owner, accountant, viewer };
      for (const role of ['owner', 'accountant', 'viewer'] as const) {
        const res = await as(env, users[role], c.request());
        if (c.allowed.includes(role)) {
          expect([200, 201, 404], `${role} ${res.body}`).toContain(res.statusCode);
          expect(res.statusCode === 404 ? res.json<{ detail: string }>().detail : '').not.toBe(
            'Organization not found.',
          );
        } else {
          expect(res.statusCode, role).toBe(403);
          expect(res.json()).toMatchObject({ code: 'forbidden' });
        }
      }
    });
  }

  it('lists members with roles', async () => {
    const res = await as(env, viewer, { method: 'GET', url: `/v1/orgs/${orgId}/members` });
    const roles = res
      .json<{ items: { userId: string; role: string }[] }>()
      .items.map((m) => [m.userId, m.role]);
    expect(roles).toEqual(
      expect.arrayContaining([
        [owner.id, 'owner'],
        [accountant.id, 'accountant'],
        [viewer.id, 'viewer'],
      ]),
    );
  });
});

describe('invitations', () => {
  async function invite(email: string, role = 'viewer') {
    return as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/invitations`,
      payload: { email, role },
    });
  }

  it('previews and accepts; the token is single use and never returned', async () => {
    const invitee = await signUp(env);
    const res = await invite(invitee.email.toUpperCase(), 'accountant');
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toMatch(/token/i);
    const token = invitationToken(env, invitee.email);

    const preview = await as(env, null, {
      method: 'POST',
      url: '/v1/invitations/preview',
      payload: { token },
    });
    expect(preview.json()).toMatchObject({
      orgName: 'Roles IE',
      email: invitee.email,
      role: 'accountant',
      status: 'pending',
    });

    const accept = await as(env, invitee, {
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toEqual({ orgId, orgName: 'Roles IE', role: 'accountant' });
    const again = await as(env, invitee, {
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token },
    });
    expect(again.statusCode).toBe(409);

    const audit = await listAuditEntries(env.tdb.db, orgId, { entity: 'membership' });
    expect(audit[0]).toMatchObject({ action: 'invitation.accept', actorId: invitee.id });
  });

  it('refuses an invitee signed in with another email', async () => {
    const invitee = await signUp(env);
    const other = await signUp(env);
    await invite(invitee.email);
    const res = await as(env, other, {
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token: invitationToken(env, invitee.email) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses duplicates: an existing member or a pending invitation', async () => {
    expect((await invite(viewer.email)).statusCode).toBe(409);
    const email = `dup-${Date.now()}@example.test`;
    expect((await invite(email)).statusCode).toBe(201);
    expect((await invite(email)).statusCode).toBe(409);
  });

  it('revokes: the token stops working and the revoke is audited', async () => {
    const invitee = await signUp(env);
    const created = (await invite(invitee.email)).json<{ id: string }>();
    const token = invitationToken(env, invitee.email);
    const revoke = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/invitations/${created.id}/revoke`,
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json<{ id: string; revokedAt: string | null }>()).toMatchObject({
      id: created.id,
    });
    expect(revoke.json<{ revokedAt: string | null }>().revokedAt).not.toBeNull();
    const accept = await as(env, invitee, {
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token },
    });
    expect(accept.statusCode).toBe(409);
    const list = await as(env, owner, { method: 'GET', url: `/v1/orgs/${orgId}/invitations` });
    expect(list.json<{ items: { id: string }[] }>().items.map((i) => i.id)).not.toContain(
      created.id,
    );
    const audit = await listAuditEntries(env.tdb.db, orgId, { entityId: created.id });
    expect(audit.map((a) => a.action)).toEqual(['revoke', 'create']);
  });

  it('answers 404 for an unknown token', async () => {
    const res = await as(env, owner, {
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token: 'x'.repeat(43) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('cannot revoke another org’s invitation through this org', async () => {
    const otherOwner = await signUp(env);
    const otherOrg = await createOrg(env, otherOwner, 'Other');
    const foreign = await as(env, otherOwner, {
      method: 'POST',
      url: `/v1/orgs/${otherOrg}/invitations`,
      payload: { email: 'someone@example.test', role: 'viewer' },
    });
    const id = foreign.json<{ id: string }>().id;
    const res = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/invitations/${id}/revoke`,
    });
    expect(res.statusCode).toBe(404);
    const [row] = await env.tdb.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, id));
    expect(row?.revokedAt).toBeNull();
  });
});
