// Member role changes, removal and leaving, with the last-owner guard (also under concurrency),
// and resending invitations.
import { schema } from '@geo-ie-accounting/db';
import { and, eq } from 'drizzle-orm';
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

beforeAll(async () => {
  env = await startApiTestEnv();
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

const patchRole = (user: TestUser, orgId: string, userId: string, role: string, key?: string) =>
  as(env, user, {
    method: 'PATCH',
    url: `/v1/orgs/${orgId}/members/${userId}`,
    payload: { role },
    ...(key ? { headers: { 'idempotency-key': key } } : {}),
  });

const remove = (user: TestUser, orgId: string, userId: string) =>
  as(env, user, { method: 'DELETE', url: `/v1/orgs/${orgId}/members/${userId}` });

async function roles(orgId: string) {
  const rows = await env.tdb.db
    .select({ userId: schema.memberships.userId, role: schema.memberships.role })
    .from(schema.memberships)
    .where(eq(schema.memberships.orgId, orgId));
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]));
}

async function orgWithTwoOwners() {
  const a = await signUp(env);
  const b = await signUp(env);
  const orgId = await createOrg(env, a, 'Two owners IE');
  await addMemberViaInvite(env, orgId, a, b, 'owner');
  return { a, b, orgId };
}

describe('role changes and removal', () => {
  it('lets an owner change a role, with an audit row and idempotent replay', async () => {
    const owner = await signUp(env);
    const member = await signUp(env);
    const orgId = await createOrg(env, owner);
    await addMemberViaInvite(env, orgId, owner, member, 'viewer');

    const res = await patchRole(owner, orgId, member.id, 'accountant', 'role-1');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: member.id, role: 'accountant' });
    const replay = await patchRole(owner, orgId, member.id, 'accountant', 'role-1');
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((await patchRole(owner, orgId, member.id, 'owner', 'role-1')).statusCode).toBe(422);

    const audit = await env.tdb.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.orgId, orgId), eq(schema.auditLog.entity, 'membership')));
    const changes = audit.filter((r) => r.action === 'role.change');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ actorId: owner.id, entityId: member.id });
    expect(changes[0]?.before).toMatchObject({ role: 'viewer' });
    expect(changes[0]?.after).toMatchObject({ role: 'accountant' });
  });

  it('refuses to leave a workspace without an owner', async () => {
    const owner = await signUp(env);
    const viewer = await signUp(env);
    const orgId = await createOrg(env, owner);
    await addMemberViaInvite(env, orgId, owner, viewer, 'viewer');

    for (const res of [
      await patchRole(owner, orgId, owner.id, 'accountant'),
      await remove(owner, orgId, owner.id),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: 'last_owner',
        detail: 'A workspace needs at least one owner. Make another member an owner first.',
      });
    }
    expect(await roles(orgId)).toEqual({ [owner.id]: 'owner', [viewer.id]: 'viewer' });
  });

  it('lets anyone leave, but only owners change or remove others', async () => {
    const owner = await signUp(env);
    const accountant = await signUp(env);
    const viewer = await signUp(env);
    const orgId = await createOrg(env, owner);
    await addMemberViaInvite(env, orgId, owner, accountant, 'accountant');
    await addMemberViaInvite(env, orgId, owner, viewer, 'viewer');

    expect((await patchRole(accountant, orgId, viewer.id, 'owner')).statusCode).toBe(403);
    expect((await remove(accountant, orgId, viewer.id)).statusCode).toBe(403);

    const leave = await remove(viewer, orgId, viewer.id);
    expect(leave.statusCode).toBe(200);
    expect((await as(env, viewer, { method: 'GET', url: `/v1/orgs/${orgId}` })).statusCode).toBe(
      404,
    );

    expect((await remove(owner, orgId, accountant.id)).statusCode).toBe(200);
    expect(await roles(orgId)).toEqual({ [owner.id]: 'owner' });
  });
});

describe('last-owner guard under concurrency', () => {
  it('two owners demoting each other at once: one wins, one owner remains', async () => {
    const { a, b, orgId } = await orgWithTwoOwners();
    const results = await Promise.all([
      patchRole(a, orgId, b.id, 'viewer'),
      patchRole(b, orgId, a.id, 'viewer'),
    ]);
    // The loser was demoted by the winner before its own change ran, so it is no longer an owner.
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    const after = await roles(orgId);
    expect(Object.values(after).filter((r) => r === 'owner')).toHaveLength(1);
  });

  it('two owners demoting themselves or leaving at once: the second gets 409', async () => {
    for (const change of ['demote', 'leave'] as const) {
      const { a, b, orgId } = await orgWithTwoOwners();
      const run = (u: TestUser) =>
        change === 'demote' ? patchRole(u, orgId, u.id, 'accountant') : remove(u, orgId, u.id);
      const results = await Promise.all([run(a), run(b)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.statusCode === 409)?.json()).toMatchObject({
        code: 'last_owner',
      });
      const after = await roles(orgId);
      expect(Object.values(after).filter((r) => r === 'owner')).toHaveLength(1);
    }
  });
});

describe('invitations', () => {
  it('resends with a new link; the old one stops working', async () => {
    const owner = await signUp(env);
    const invitee = await signUp(env);
    const orgId = await createOrg(env, owner);
    const created = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/invitations`,
      payload: { email: invitee.email, role: 'accountant' },
    });
    const { id } = created.json<{ id: string }>();
    const oldToken = invitationToken(env, invitee.email);

    const resend = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/invitations/${id}/resend`,
    });
    expect(resend.statusCode).toBe(200);
    const newToken = invitationToken(env, invitee.email);
    expect(newToken).not.toBe(oldToken);

    const accept = (token: string) =>
      as(env, invitee, { method: 'POST', url: '/v1/invitations/accept', payload: { token } });
    expect((await accept(oldToken)).statusCode).toBe(404);
    expect((await accept(newToken)).statusCode).toBe(200);
    // Accepted: no more resends.
    const again = await as(env, owner, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/invitations/${id}/resend`,
    });
    expect(again.statusCode).toBe(409);
  });
});
