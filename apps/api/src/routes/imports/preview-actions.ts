// Import preview actions beyond the single-row PATCH: bulk row edits and re-applying the
// categorisation rules to the rows the user has not edited. Statement contents are never logged.
import {
  ApplyRulesResponse,
  BulkUpdateImportRowsRequest,
  BulkUpdateImportRowsResponse,
  ImportBatchParams,
  MutationHeaders,
  type ImportBatchStats,
  type ImportRowStatus,
} from '@geo-ie-accounting/contracts';
import {
  getAccount,
  getImportBatch,
  getImportRowsByIds,
  listImportRows,
  updateImportBatch,
  updateImportRow,
  type AccountRow,
  type ImportBatchRow,
  type Tx,
} from '@geo-ie-accounting/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import { toImportRowDto } from '../dto';
import { loadSuggester } from './suggest';

/** Throws 422 unless `account` can be the other side of a row in `currency` of this batch. */
export function assertBookable(
  account: AccountRow | null,
  bankAccountId: string,
  currency: string,
): asserts account is AccountRow {
  if (!account || account.archivedAt) {
    throw new HttpProblem(422, 'validation_failed', 'Account not found.');
  }
  if (account.id === bankAccountId) {
    throw new HttpProblem(
      422,
      'validation_failed',
      'Pick an account other than the bank account itself.',
    );
  }
  if (account.currency !== null && account.currency !== currency) {
    throw new HttpProblem(
      422,
      'validation_failed',
      `The account is in ${account.currency}, the row in ${currency}.`,
    );
  }
}

/** Locks a batch that is still in preview, or throws 404 / 409. */
export async function lockPreviewBatch(
  tx: Tx,
  orgId: string,
  batchId: string,
): Promise<ImportBatchRow> {
  const batch = await getImportBatch(tx, orgId, batchId, { forUpdate: true });
  if (!batch) throw new HttpProblem(404, 'not_found', 'Import not found.');
  if (batch.status !== 'preview') {
    throw new HttpProblem(409, 'conflict', 'This import is already committed.');
  }
  return batch;
}

/** Batch stats after rows moved between `new` and `skipped`. */
export function statsAfter(
  stats: Partial<ImportBatchStats>,
  changes: readonly { from: ImportRowStatus; to: ImportRowStatus }[],
): Partial<ImportBatchStats> {
  let skippedDelta = 0;
  for (const c of changes) {
    if (c.from === c.to) continue;
    if (c.to === 'skipped') skippedDelta++;
    else if (c.from === 'skipped') skippedDelta--;
  }
  if (skippedDelta === 0) return stats;
  return {
    ...stats,
    new: (stats.new ?? 0) - skippedDelta,
    skipped: (stats.skipped ?? 0) + skippedDelta,
  };
}

export const previewActionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/v1/orgs/:orgId/imports/:batchId/rows/bulk',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'bulkUpdateImportRows',
        tags: ['imports'],
        summary: 'Set the account of several preview rows, or skip them, at once',
        description:
          'Same rules as `PATCH .../rows/:rowId`, all or nothing. Duplicate rows are left as ' +
          'they are and listed in `ignored`.',
        headers: MutationHeaders,
        params: ImportBatchParams,
        body: BulkUpdateImportRowsRequest,
        response: { 200: BulkUpdateImportRowsResponse, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, batchId } = req.params;
      const { rowIds, accountId, skip } = req.body;
      const batch = await lockPreviewBatch(req.tx, orgId, batchId);
      const rows = await getImportRowsByIds(req.tx, orgId, batchId, rowIds);
      if (rows.length !== new Set(rowIds).size) {
        throw new HttpProblem(404, 'not_found', 'Some rows are not in this import.');
      }
      if (accountId) {
        const account = await getAccount(req.tx, orgId, accountId);
        for (const row of rows) assertBookable(account, batch.accountId, row.currency);
      }

      const changed = [];
      const ignored: string[] = [];
      for (const row of rows) {
        if (row.status === 'duplicate') {
          ignored.push(row.id);
          continue;
        }
        const updated = await updateImportRow(req.tx, orgId, row.id, {
          ...(accountId !== undefined ? { chosenAccountId: accountId } : {}),
          ...(skip !== undefined ? { status: skip ? 'skipped' : 'new' } : {}),
        });
        await req.audit(
          'import_row',
          row.id,
          { status: row.status, chosenAccountId: row.chosenAccountId },
          { status: updated.status, chosenAccountId: updated.chosenAccountId },
          { action: 'bulk_update' },
        );
        changed.push({ before: row, after: updated });
      }
      if (changed.length === 0) {
        // Nothing to change still answers with an audit row, like any tenant mutation.
        await req.audit(
          'import_batch',
          batchId,
          null,
          { bulkUpdate: 0 },
          { action: 'bulk_update' },
        );
      }
      const stats = statsAfter(
        batch.stats,
        changed.map((c) => ({ from: c.before.status, to: c.after.status })),
      );
      if (stats !== batch.stats) await updateImportBatch(req.tx, orgId, batchId, { stats });
      return { rows: changed.map((c) => toImportRowDto(c.after)), ignored };
    },
  );

  app.post(
    '/v1/orgs/:orgId/imports/:batchId/apply-rules',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'applyImportRules',
        tags: ['imports'],
        summary: 'Re-apply the categorisation rules to the unedited rows of a preview',
        description:
          'Rows with an account the user chose, and duplicates, keep what they have. The ' +
          'others get the first matching rule, else the fixed suggestion. Returns every row.',
        headers: MutationHeaders,
        params: ImportBatchParams,
        response: { 200: ApplyRulesResponse, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, batchId } = req.params;
      const batch = await lockPreviewBatch(req.tx, orgId, batchId);
      const suggest = await loadSuggester(req.tx, orgId, batch.accountId);
      const rows = await listImportRows(req.tx, orgId, batchId, {});
      let updated = 0;
      const result = [];
      for (const row of rows) {
        if (row.status === 'duplicate' || row.chosenAccountId !== null) {
          result.push(row);
          continue;
        }
        const s = suggest(row);
        if (s.accountId === row.suggestedAccountId && s.ruleId === row.suggestedRuleId) {
          result.push(row);
          continue;
        }
        result.push(
          await updateImportRow(req.tx, orgId, row.id, {
            suggestedAccountId: s.accountId,
            suggestedRuleId: s.ruleId,
          }),
        );
        updated++;
      }
      await req.audit(
        'import_batch',
        batchId,
        null,
        { rowsResuggested: updated },
        {
          action: 'apply_rules',
        },
      );
      return { updated, rows: result.map(toImportRowDto) };
    },
  );
};
