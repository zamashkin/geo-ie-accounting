// POST /v1/orgs/:orgId/imports/:batchId/commit: books every `new` row of a preview batch.
//
// NBG may have to be asked for a rate (resolveRate), and network calls never run inside the
// request transaction. So a preHandler, which runs before the transaction wrapper, resolves the
// rate of every (currency, booked date) the batch needs with the pool; the handler then only reads
// that map inside `req.tx`.
import { CommitImportResponse, ImportBatchParams, MutationHeaders } from '@ie-ledger/contracts';
import {
  findFingerprints,
  getImportBatch,
  insertFingerprints,
  insertTransaction,
  listAccounts,
  listImportRows,
  resolveRate,
  updateImportBatch,
  updateImportRow,
  type ExchangeRateRow,
} from '@ie-ledger/db';
import {
  BASE_CURRENCY,
  bankStatementLine,
  dedupeHashes,
  money,
  parseRate,
} from '@ie-ledger/domain';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import { toImportBatchDto } from '../dto';
import type { LedgerDeps } from '../ledger-deps';

const rateKey = (currency: string, date: string) => `${currency}|${date}`;

/** Rates resolved before the transaction, per request. */
const resolvedRates = new WeakMap<FastifyRequest, Map<string, ExchangeRateRow>>();

/** Transaction description: counterparty first, the bank's text after it. */
function describe(row: { counterparty: string | null; description: string }) {
  const text = [row.counterparty, row.description].filter((s) => s && s.trim() !== '').join(' — ');
  return (text || 'Bank statement line').slice(0, 1000);
}

export const commitRoutes: FastifyPluginAsyncZod<{ deps: LedgerDeps }> = async (app, opts) => {
  const { deps } = opts;

  app.post(
    '/v1/orgs/:orgId/imports/:batchId/commit',
    {
      onRequest: requireRole('accountant'),
      preHandler: async (req) => {
        const { orgId, batchId } = req.params;
        const batch = await getImportBatch(app.db, orgId, batchId);
        if (!batch) throw new HttpProblem(404, 'not_found', 'Import not found.');
        const rows = await listImportRows(app.db, orgId, batchId, { status: 'new' });
        const needed = new Map<string, { currency: string; date: string }>();
        for (const r of rows) {
          if (r.currency === BASE_CURRENCY) continue;
          needed.set(rateKey(r.currency, r.bookedOn), { currency: r.currency, date: r.bookedOn });
        }
        const rates = new Map<string, ExchangeRateRow>();
        for (const [key, { currency, date }] of needed) {
          try {
            rates.set(key, await resolveRate(app.db, deps.rates, currency, date, deps.now()));
          } catch (err) {
            req.log.warn({ err, currency, date }, 'NBG rate could not be resolved');
            throw new HttpProblem(
              503,
              'rate_unavailable',
              `The NBG rate for ${currency} on ${date} is not available. Try again later.`,
            );
          }
        }
        resolvedRates.set(req, rates);
      },
      schema: {
        operationId: 'commitImport',
        tags: ['imports'],
        summary: 'Book every new row of a preview batch, one transaction per row',
        description:
          'Each row is converted to GEL at the NBG rate of its booked date. Fails with 422 if a ' +
          '`new` row has no account (pick one or skip the row). Rows found in the ledger since ' +
          'the upload are marked `duplicate` instead of being booked.',
        headers: MutationHeaders,
        params: ImportBatchParams,
        response: { 200: CommitImportResponse, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, batchId } = req.params;
      const rates = resolvedRates.get(req) ?? new Map<string, ExchangeRateRow>();

      const batch = await getImportBatch(req.tx, orgId, batchId, { forUpdate: true });
      if (!batch) throw new HttpProblem(404, 'not_found', 'Import not found.');
      if (batch.status !== 'preview') {
        throw new HttpProblem(409, 'conflict', 'This import is already committed.');
      }

      const rows = await listImportRows(req.tx, orgId, batchId, { status: 'new' });
      const unassigned = rows.filter((r) => (r.chosenAccountId ?? r.suggestedAccountId) === null);
      if (unassigned.length > 0) {
        throw new HttpProblem(
          422,
          'validation_failed',
          'Pick an account for every new row, or skip it.',
          unassigned.map((r) => ({ path: `rows/${r.id}`, message: 'No account chosen' })),
        );
      }

      const accounts = new Map(
        (await listAccounts(req.tx, orgId, { includeArchived: true })).map((a) => [a.id, a]),
      );
      const hashesByRow = new Map(
        rows.map((r) => [r.id, dedupeHashes({ ...r, accountId: batch.accountId })]),
      );
      // Lines another import booked since this preview was made.
      const stored = await findFingerprints(
        req.tx,
        orgId,
        batch.accountId,
        [...hashesByRow.values()].flat(),
      );

      const transactionIds: string[] = [];
      let lateDuplicates = 0;
      for (const row of rows) {
        const hashes = hashesByRow.get(row.id) ?? [];
        const existing = hashes.map((h) => stored.get(h)).find((t) => t !== undefined);
        if (existing !== undefined) {
          await updateImportRow(req.tx, orgId, row.id, {
            status: 'duplicate',
            transactionId: existing,
          });
          lateDuplicates++;
          continue;
        }

        const counter = accounts.get(row.chosenAccountId ?? row.suggestedAccountId ?? '');
        if (!counter) throw new HttpProblem(422, 'validation_failed', 'Account not found.');
        let rate = null;
        if (row.currency !== BASE_CURRENCY) {
          const stored = rates.get(rateKey(row.currency, row.bookedOn));
          if (!stored) {
            throw new HttpProblem(409, 'conflict', 'The import changed while committing. Retry.');
          }
          rate = { id: stored.id, rateScaled: parseRate(stored.rate), quantity: stored.quantity };
        }
        const draft = bankStatementLine({
          occurredOn: row.bookedOn,
          description: describe(row),
          bankAccountId: batch.accountId,
          counterAccountId: counter.id,
          amount: money(row.amountMinor, row.currency),
          rate,
          // Income from a bank statement is "received to bank account": return line 20.
          paymentMethod: counter.kind === 'income' ? 'bank' : null,
        });
        const created = await insertTransaction(req.tx, orgId, req.user.id, draft, {
          importBatchId: batch.id,
        });
        await insertFingerprints(req.tx, orgId, batch.accountId, created.id, hashes);
        await updateImportRow(req.tx, orgId, row.id, { transactionId: created.id });
        await req.audit('transaction', created.id, null, {
          source: created.source,
          occurredOn: created.occurredOn,
          importBatchId: batch.id,
          importRowId: row.id,
          postings: draft.postings,
        });
        transactionIds.push(created.id);
      }

      const updated = await updateImportBatch(req.tx, orgId, batchId, {
        status: 'committed',
        stats: {
          ...batch.stats,
          new: (batch.stats.new ?? 0) - lateDuplicates,
          duplicate: (batch.stats.duplicate ?? 0) + lateDuplicates,
          committed: transactionIds.length,
        },
      });
      await req.audit(
        'import_batch',
        batch.id,
        { status: batch.status },
        { status: updated.status, stats: updated.stats },
        { action: 'commit' },
      );
      return { batch: toImportBatchDto(updated), transactionIds };
    },
  );
};
