import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import { auditLog } from '../schema/index';

export type AuditLogRow = typeof auditLog.$inferSelect;

export interface NewAuditEntry {
  /** null for system actions (worker jobs). */
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestId: string | null;
}

/** Writes one audit row. Call it with the mutation's transaction so both commit together. */
export async function insertAuditEntry(
  db: DbOrTx,
  orgId: string,
  entry: NewAuditEntry,
): Promise<AuditLogRow> {
  const [row] = await db
    .insert(auditLog)
    .values({ ...entry, orgId })
    .returning();
  if (!row) throw new Error('audit insert returned no row');
  return row;
}

/** Newest first. Optional filter by entity and id. */
export async function listAuditEntries(
  db: DbOrTx,
  orgId: string,
  filter: { entity?: string; entityId?: string; limit?: number } = {},
): Promise<AuditLogRow[]> {
  return db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.orgId, orgId),
        filter.entity === undefined ? undefined : eq(auditLog.entity, filter.entity),
        filter.entityId === undefined ? undefined : eq(auditLog.entityId, filter.entityId),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(filter.limit ?? 100);
}
