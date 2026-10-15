import { and, eq, isNull, lt } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client';
import { idempotencyKeys } from '../schema/index';

// Idempotency keys (ARCHITECTURE §7, ADR 0010). A key is scoped to (org, user); `orgId` is null
// for mutations that have no org yet.

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;

export interface IdempotencyScope {
  orgId: string | null;
  userId: string;
  key: string;
}

/** How long a stored response is replayed. Older keys are treated as unused. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type ClaimResult = { status: 'claimed' } | { status: 'existing'; record: IdempotencyKeyRow };

const scopeWhere = (scope: IdempotencyScope) =>
  and(
    scope.orgId === null ? isNull(idempotencyKeys.orgId) : eq(idempotencyKeys.orgId, scope.orgId),
    eq(idempotencyKeys.userId, scope.userId),
    eq(idempotencyKeys.key, scope.key),
  );

/**
 * Claims a key inside the request's transaction. Returns `claimed` when this request owns it,
 * or the stored record when a previous request already completed with it.
 *
 * If another transaction holds the same key uncommitted, the INSERT waits on the unique index
 * until that transaction ends: the caller then sees its stored response (commit) or claims the
 * key itself (rollback). No "in progress" state is ever visible to other requests.
 */
export async function claimIdempotencyKey(
  tx: Tx,
  scope: IdempotencyScope,
  requestHash: string,
  now: Date = new Date(),
): Promise<ClaimResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const inserted = await tx
      .insert(idempotencyKeys)
      .values({ ...scope, requestHash })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (inserted.length > 0) return { status: 'claimed' };

    const [record] = await tx.select().from(idempotencyKeys).where(scopeWhere(scope));
    if (!record) continue; // deleted between the two statements; try the insert again
    if (now.getTime() - record.createdAt.getTime() < IDEMPOTENCY_TTL_MS) {
      return { status: 'existing', record };
    }
    // Expired: forget the old response and claim the key afresh.
    await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.id, record.id));
  }
  throw new Error('could not claim idempotency key');
}

/** Stores the response of the request that claimed the key, in the same transaction. */
export async function completeIdempotencyKey(
  tx: Tx,
  scope: IdempotencyScope,
  statusCode: number,
  response: unknown,
): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({ statusCode, response: response ?? null })
    .where(scopeWhere(scope));
}

/** Housekeeping for a scheduled job: drops keys older than the replay window. */
export async function deleteExpiredIdempotencyKeys(
  db: DbOrTx,
  now: Date = new Date(),
): Promise<number> {
  const deleted = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, new Date(now.getTime() - IDEMPOTENCY_TTL_MS)))
    .returning({ id: idempotencyKeys.id });
  return deleted.length;
}
