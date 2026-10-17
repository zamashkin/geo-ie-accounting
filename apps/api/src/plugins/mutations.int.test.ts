import { schema } from '@geo-ie-accounting/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  as,
  createOrg,
  signUp,
  startApiTestEnv,
  type ApiTestEnv,
  type TestUser,
} from '../testing/env';
import { requireRole } from './authz';

let env: ApiTestEnv;
let user: TestUser;
let orgId: string;

/** Routes that exercise the wrapper's failure paths, as another workstream would write them. */
const testRoutes: FastifyPluginAsyncZod = async (app) => {
  // Posts an unbalanced transaction: the deferred balance trigger fires at COMMIT.
  app.post(
    '/v1/orgs/:orgId/test/unbalanced',
    { onRequest: requireRole('accountant'), schema: { params: z.object({ orgId: z.uuid() }) } },
    async (req, reply) => {
      const { orgId: org } = req.membership;
      const accounts = await req.tx
        .select()
        .from(schema.accounts)
        .where(and(eq(schema.accounts.orgId, org), eq(schema.accounts.currency, 'GEL')));
      const [t] = await req.tx
        .insert(schema.transactions)
        .values({
          orgId: org,
          occurredOn: '2026-01-05',
          description: 'unbalanced',
          source: 'manual',
          createdBy: req.user.id,
        })
        .returning();
      await req.tx.insert(schema.postings).values(
        [100n, -99n].map((amount, i) => ({
          transactionId: t!.id,
          orgId: org,
          accountId: accounts[i]!.id,
          amountMinor: amount,
          currency: 'GEL',
          gelAmountMinor: amount,
        })),
      );
      await req.audit('transaction', t!.id, null, t!);
      reply.code(201);
      return { id: t!.id };
    },
  );

  app.post('/v1/orgs/:orgId/test/no-audit', { onRequest: requireRole('viewer') }, async () => ({
    ok: true,
  }));
};

beforeAll(async () => {
  env = await startApiTestEnv();
  await env.app.register(testRoutes);
  user = await signUp(env);
  orgId = await createOrg(env, user);
});

afterAll(async () => {
  await (env as ApiTestEnv | undefined)?.close();
});

const orgCount = async (name: string) =>
  (await env.tdb.db.select().from(schema.organizations).where(eq(schema.organizations.name, name)))
    .length;

const createWithKey = (u: TestUser, key: string, name: string) =>
  as(env, u, {
    method: 'POST',
    url: '/v1/orgs',
    headers: { 'idempotency-key': key },
    payload: { name },
  });

describe('Idempotency-Key', () => {
  it('replays the stored response for the same request and creates nothing new', async () => {
    const first = await createWithKey(user, 'key-replay', 'Replay IE');
    const second = await createWithKey(user, 'key-replay', 'Replay IE');
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.body).toBe(first.body);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.headers['content-type']).toContain('application/json');
    expect(await orgCount('Replay IE')).toBe(1);
  });

  it('answers 422 when the same key comes with a different body', async () => {
    await createWithKey(user, 'key-mismatch', 'First IE');
    const res = await createWithKey(user, 'key-mismatch', 'Second IE');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'idempotency_key_reused' });
    expect(await orgCount('Second IE')).toBe(0);
  });

  it('keeps keys per user', async () => {
    const other = await signUp(env);
    const a = await createWithKey(user, 'key-shared', 'Shared IE');
    const b = await createWithKey(other, 'key-shared', 'Shared IE');
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect(b.json<{ id: string }>().id).not.toBe(a.json<{ id: string }>().id);
  });

  it('runs concurrent duplicates once', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => createWithKey(user, 'key-race', 'Race IE')),
    );
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.json<{ id: string }>().id)).size).toBe(1);
    expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(3);
    expect(await orgCount('Race IE')).toBe(1);
  });

  it('replays tenant mutations without repeating side effects', async () => {
    const send = () =>
      as(env, user, {
        method: 'POST',
        url: `/v1/orgs/${orgId}/invitations`,
        headers: { 'idempotency-key': 'invite-once' },
        payload: { email: 'once@example.test', role: 'viewer' },
      });
    const mailsBefore = env.mailer.outbox.length;
    const [a, b] = [await send(), await send()];
    expect(b.body).toBe(a.body);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(env.mailer.outbox.length - mailsBefore).toBe(1);
  });
});

describe('withTx', () => {
  it('turns a deferred constraint failure at COMMIT into 422 and keeps nothing', async () => {
    const send = () =>
      as(env, user, {
        method: 'POST',
        url: `/v1/orgs/${orgId}/test/unbalanced`,
        headers: { 'idempotency-key': 'unbalanced' },
        payload: {},
      });
    const res = await send();
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'validation_failed',
      detail: 'Postings must sum to zero in every currency.',
    });
    const txs = await env.tdb.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.orgId, orgId));
    expect(txs).toHaveLength(0);
    const audit = await env.tdb.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.orgId, orgId), eq(schema.auditLog.entity, 'transaction')));
    expect(audit).toHaveLength(0);
    // Failures are not stored: the retry runs again (and fails again).
    expect((await send()).headers['idempotent-replayed']).toBeUndefined();
  });

  it('fails a tenant mutation that wrote no audit row', async () => {
    const res = await as(env, user, {
      method: 'POST',
      url: `/v1/orgs/${orgId}/test/no-audit`,
      payload: {},
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'internal_error' });
  });
});
