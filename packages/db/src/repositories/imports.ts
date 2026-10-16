// Import batches, their parsed rows and the dedupe fingerprints (ARCHITECTURE §6). Rows hold
// statement data: never log them.
import type { ImportBatchStatus, ImportBatchStats, ImportRowStatus } from '@ie-ledger/contracts';
import { and, asc, desc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client';
import { importBatches, importRows, transactionFingerprints } from '../schema/index';

export type ImportBatchRow = typeof importBatches.$inferSelect;
export type NewImportBatch = Omit<
  typeof importBatches.$inferInsert,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
>;
export type ImportRowRow = typeof importRows.$inferSelect;
export type NewImportRow = Omit<typeof importRows.$inferInsert, 'id' | 'orgId' | 'batchId'>;

// ── Batches ─────────────────────────────────────────────────────────────────────────────

export async function createImportBatch(
  tx: Tx,
  orgId: string,
  batch: NewImportBatch,
  rows: readonly NewImportRow[],
): Promise<{ batch: ImportBatchRow; rows: ImportRowRow[] }> {
  const [created] = await tx
    .insert(importBatches)
    .values({ ...batch, orgId })
    .returning();
  if (!created) throw new Error('import batch insert returned no row');
  const inserted =
    rows.length === 0
      ? []
      : await tx
          .insert(importRows)
          .values(rows.map((r) => ({ ...r, orgId, batchId: created.id })))
          .returning();
  return { batch: created, rows: inserted.sort((a, b) => a.rowIndex - b.rowIndex) };
}

/** One batch of the org. `forUpdate` locks it until the transaction ends (commit). */
export async function getImportBatch(
  db: DbOrTx,
  orgId: string,
  batchId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ImportBatchRow | null> {
  const query = db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.orgId, orgId), eq(importBatches.id, batchId)));
  const [row] = opts.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

/** Newest first, keyset-paginated on (created_at, id). */
export async function listImportBatches(
  db: DbOrTx,
  orgId: string,
  page: { after?: { createdAt: Date; id: string } | undefined; limit: number },
): Promise<ImportBatchRow[]> {
  const { after } = page;
  return db
    .select()
    .from(importBatches)
    .where(
      and(
        eq(importBatches.orgId, orgId),
        after
          ? or(
              lt(importBatches.createdAt, after.createdAt),
              and(eq(importBatches.createdAt, after.createdAt), lt(importBatches.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(importBatches.createdAt), desc(importBatches.id))
    .limit(page.limit);
}

export async function updateImportBatch(
  tx: Tx,
  orgId: string,
  batchId: string,
  patch: { status?: ImportBatchStatus; stats?: Partial<ImportBatchStats> },
): Promise<ImportBatchRow> {
  const [row] = await tx
    .update(importBatches)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(importBatches.orgId, orgId), eq(importBatches.id, batchId)))
    .returning();
  if (!row) throw new Error('import batch update returned no row');
  return row;
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────

/** Rows of a batch in statement order. `afterIndex` is the last row index seen. */
export async function listImportRows(
  db: DbOrTx,
  orgId: string,
  batchId: string,
  page: { afterIndex?: number | undefined; limit?: number | undefined; status?: ImportRowStatus },
): Promise<ImportRowRow[]> {
  const query = db
    .select()
    .from(importRows)
    .where(
      and(
        eq(importRows.orgId, orgId),
        eq(importRows.batchId, batchId),
        page.afterIndex === undefined ? undefined : gt(importRows.rowIndex, page.afterIndex),
        page.status === undefined ? undefined : eq(importRows.status, page.status),
      ),
    )
    .orderBy(asc(importRows.rowIndex));
  return page.limit === undefined ? query : query.limit(page.limit);
}

export async function getImportRow(
  db: DbOrTx,
  orgId: string,
  batchId: string,
  rowId: string,
): Promise<ImportRowRow | null> {
  const [row] = await db
    .select()
    .from(importRows)
    .where(
      and(eq(importRows.orgId, orgId), eq(importRows.batchId, batchId), eq(importRows.id, rowId)),
    );
  return row ?? null;
}

/** Rows of a batch by id, in statement order. Ids of other batches or orgs are not returned. */
export async function getImportRowsByIds(
  db: DbOrTx,
  orgId: string,
  batchId: string,
  rowIds: readonly string[],
): Promise<ImportRowRow[]> {
  if (rowIds.length === 0) return [];
  return db
    .select()
    .from(importRows)
    .where(
      and(
        eq(importRows.orgId, orgId),
        eq(importRows.batchId, batchId),
        inArray(importRows.id, [...new Set(rowIds)]),
      ),
    )
    .orderBy(asc(importRows.rowIndex));
}

export async function updateImportRow(
  tx: Tx,
  orgId: string,
  rowId: string,
  patch: {
    status?: ImportRowStatus;
    chosenAccountId?: string | null;
    suggestedAccountId?: string | null;
    suggestedRuleId?: string | null;
    transactionId?: string | null;
  },
): Promise<ImportRowRow> {
  const [row] = await tx
    .update(importRows)
    .set(patch)
    .where(and(eq(importRows.orgId, orgId), eq(importRows.id, rowId)))
    .returning();
  if (!row) throw new Error('import row update returned no row');
  return row;
}

// ── Fingerprints ────────────────────────────────────────────────────────────────────────

/** Stored fingerprints among `hashes` for the account: hash → transaction id. */
export async function findFingerprints(
  db: DbOrTx,
  orgId: string,
  accountId: string,
  hashes: readonly string[],
): Promise<Map<string, string>> {
  if (hashes.length === 0) return new Map();
  const rows = await db
    .select({
      dedupeHash: transactionFingerprints.dedupeHash,
      transactionId: transactionFingerprints.transactionId,
    })
    .from(transactionFingerprints)
    .where(
      and(
        eq(transactionFingerprints.orgId, orgId),
        eq(transactionFingerprints.accountId, accountId),
        inArray(transactionFingerprints.dedupeHash, [...new Set(hashes)]),
      ),
    );
  return new Map(rows.map((r) => [r.dedupeHash, r.transactionId]));
}

/**
 * Records the fingerprints of a committed line. A hash already stored (by a concurrent commit)
 * fails the transaction with a unique violation, which the caller retries.
 */
export async function insertFingerprints(
  tx: Tx,
  orgId: string,
  accountId: string,
  transactionId: string,
  hashes: readonly string[],
): Promise<void> {
  if (hashes.length === 0) return;
  await tx
    .insert(transactionFingerprints)
    .values(
      [...new Set(hashes)].map((dedupeHash) => ({ orgId, accountId, dedupeHash, transactionId })),
    );
}
