// Statement imports, synchronous in the MVP (ADR 0012): upload → preview → row edits → commit.
// Statement contents (rows, names, IBANs, amounts) are never logged.
import { createHash } from 'node:crypto';
import multipart from '@fastify/multipart';
import {
  IMPORT_MAX_FILE_BYTES,
  ImportBatchDetail,
  ImportBatchList,
  ImportBatchParams,
  ImportRowList,
  ImportRowParams,
  ImportRowView,
  ListImportRowsQuery,
  MutationHeaders,
  OrgParams,
  PaginationQuery,
  UpdateImportRowRequest,
  UploadStatementRequest,
  UploadStatementResponse,
  type AccountMatchOutcome,
  type Bank,
  type ParseResult,
  type ParserId,
} from '@ie-ledger/contracts';
import {
  createImportBatch,
  findFingerprints,
  getAccount,
  getImportBatch,
  getImportRow,
  listImportBatches,
  listImportRows,
  matchOrCreateBankAccount,
  updateImportBatch,
  updateImportRow,
  type AccountRow,
  type NewImportRow,
} from '@ie-ledger/db';
import { dedupeHashes } from '@ie-ledger/domain';
import { detectBest, MIN_CONFIDENCE } from '@ie-ledger/importers';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import { decodeCursor, encodeCursor, toAccountDto, toImportBatchDto, toImportRowDto } from '../dto';
import type { LedgerDeps } from '../ledger-deps';
import { commitRoutes } from './commit';
import {
  assertBookable,
  lockPreviewBatch,
  previewActionRoutes,
  statsAfter,
} from './preview-actions';
import { loadSuggester } from './suggest';

interface Upload {
  bytes: Uint8Array;
  fileName: string;
}

/** The uploaded bytes, read in preValidation (outside the request transaction). */
const uploads = new WeakMap<FastifyRequest, Upload>();

const BatchCursor = z.object({ c: z.iso.datetime(), id: z.uuid() });
const RowCursor = z.object({ i: z.int().nonnegative() });

function bankOf(parserId: ParserId): Bank {
  if (parserId.startsWith('bog-')) return 'bog';
  if (parserId.startsWith('tbc-')) return 'tbc';
  return 'other';
}

/**
 * Reads the single `file` part (and an optional `accountId` field) and replaces the body with a
 * description of the upload. Runs before validation and before the Idempotency-Key hash, so a
 * different file under the same key is a different request.
 */
async function readUpload(req: FastifyRequest) {
  if (!req.isMultipart()) {
    throw new HttpProblem(415, 'bad_request', 'Send the statement as multipart/form-data.');
  }
  let upload: Upload | undefined;
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'file' || upload) {
        throw new HttpProblem(400, 'bad_request', 'Send exactly one file, in the `file` field.');
      }
      upload = { bytes: await part.toBuffer(), fileName: part.filename.slice(0, 255) };
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }
  if (!upload || upload.bytes.length === 0) {
    throw new HttpProblem(400, 'bad_request', 'The `file` field is missing or empty.');
  }
  uploads.set(req, upload);
  req.body = {
    file: {
      name: upload.fileName,
      size: upload.bytes.length,
      sha256: createHash('sha256').update(upload.bytes).digest('hex'),
    },
    ...(fields.accountId === undefined ? {} : { accountId: fields.accountId }),
  };
}

/** Parses with the account currency the statement declares (BoG headers carry it). */
function parseStatement(upload: Upload, chosenCurrency: string | null) {
  const detection = detectBest(upload.bytes, upload.fileName);
  if (!detection || detection.confidence < MIN_CONFIDENCE || detection.parserId === 'generic-csv') {
    throw new HttpProblem(
      422,
      'validation_failed',
      'Unrecognised statement format. The MVP reads Bank of Georgia XLSX and CSV exports.',
    );
  }
  let result: ParseResult = detection.parser.parse(upload.bytes, {
    accountCurrency: chosenCurrency ?? 'GEL',
  });
  const declared = result.meta.currency;
  if (chosenCurrency === null && declared !== null && declared !== 'GEL') {
    result = detection.parser.parse(upload.bytes, { accountCurrency: declared });
  }
  if (result.rows.length === 0) {
    throw new HttpProblem(422, 'validation_failed', 'The statement has no transactions to import.');
  }
  return { detection, result };
}

export const importRoutes: FastifyPluginAsyncZod<{ deps: LedgerDeps }> = async (app, opts) => {
  await app.register(multipart, {
    limits: { fileSize: IMPORT_MAX_FILE_BYTES, files: 1, fields: 5, parts: 6 },
  });

  app.post(
    '/v1/orgs/:orgId/imports',
    {
      onRequest: requireRole('accountant'),
      preValidation: readUpload,
      schema: {
        operationId: 'uploadStatement',
        tags: ['imports'],
        summary: 'Upload a bank statement and get a preview batch',
        description:
          'Detects the format, parses the file, matches or creates the bank account on IBAN + ' +
          'currency and marks rows already in the ledger (or repeated in the file) as ' +
          '`duplicate`. The file itself is not stored. At most 5 MB.',
        consumes: ['multipart/form-data'],
        headers: MutationHeaders,
        params: OrgParams,
        body: UploadStatementRequest,
        response: { 201: UploadStatementResponse, default: problemResponse },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      const upload = uploads.get(req);
      if (!upload) throw new Error('upload missing after preValidation');
      const body = req.body as { file: { sha256: string }; accountId?: string };

      let chosen: AccountRow | null = null;
      if (body.accountId !== undefined) {
        chosen = await getAccount(req.tx, orgId, body.accountId);
        if (!chosen || chosen.kind !== 'asset' || !chosen.currency || chosen.systemKey) {
          throw new HttpProblem(422, 'validation_failed', 'accountId must be a bank account.');
        }
      }

      const { detection, result } = parseStatement(upload, chosen?.currency ?? null);
      const currency = chosen?.currency ?? result.meta.currency;
      if (!currency) {
        throw new HttpProblem(
          422,
          'validation_failed',
          'The statement does not say its currency. Send accountId.',
        );
      }
      if (result.meta.currency && result.meta.currency !== currency) {
        throw new HttpProblem(
          422,
          'validation_failed',
          `The statement is in ${result.meta.currency}, the account in ${currency}.`,
        );
      }
      if (result.rows.some((r) => r.currency !== currency)) {
        throw new HttpProblem(
          422,
          'validation_failed',
          `Every line must be in the account currency (${currency}).`,
        );
      }

      let account: AccountRow;
      let accountMatch: AccountMatchOutcome;
      if (chosen) {
        account = chosen;
        accountMatch = 'chosen';
      } else {
        const iban = result.meta.accountIban;
        if (!iban) {
          throw new HttpProblem(
            422,
            'validation_failed',
            'The statement has no account number. Send accountId.',
          );
        }
        const match = await matchOrCreateBankAccount(
          req.tx,
          orgId,
          { iban, currency },
          bankOf(detection.parserId),
        );
        account = match.account;
        accountMatch = match.outcome;
        if (match.outcome !== 'matched') {
          await req.audit('account', account.id, match.before, account);
        }
      }

      // Categorisation rules first, then the fixed suggestions (docs/MVP.md).
      const suggest = await loadSuggester(req.tx, orgId, account.id);

      const hashes = result.rows.map((r) => dedupeHashes({ ...r, accountId: account.id }));
      const stored = await findFingerprints(req.tx, orgId, account.id, hashes.flat());
      const seen = new Set<string>();
      const rows: NewImportRow[] = result.rows.map((r, i) => {
        const own = hashes[i] ?? [];
        const existing = own.map((h) => stored.get(h)).find((t) => t !== undefined);
        const duplicate = existing !== undefined || own.some((h) => seen.has(h));
        for (const h of own) seen.add(h);
        const suggestion = suggest(r);
        return {
          rowIndex: r.rowIndex,
          raw: r.raw,
          bookedOn: r.bookedOn,
          amountMinor: r.amountMinor,
          currency: r.currency,
          counterparty: r.counterparty,
          counterpartyAccount: r.counterpartyAccount,
          description: r.description,
          bankReference: r.bankReference,
          documentNumber: r.documentNumber,
          operationType: r.operationType,
          bankGelAmountMinor: r.bankGelAmountMinor,
          counterAmountMinor: r.counterAmountMinor,
          counterCurrency: r.counterCurrency,
          dedupeHash: own[0] ?? '',
          status: duplicate ? 'duplicate' : 'new',
          suggestedAccountId: suggestion.accountId,
          suggestedRuleId: suggestion.ruleId,
          transactionId: existing ?? null,
        };
      });
      const duplicates = rows.filter((r) => r.status === 'duplicate').length;

      const { batch } = await createImportBatch(
        req.tx,
        orgId,
        {
          accountId: account.id,
          bankFormat: detection.parserId,
          fileKey: null,
          fileSha256: body.file.sha256,
          fileName: upload.fileName,
          status: 'preview',
          stats: {
            total: rows.length,
            new: rows.length - duplicates,
            duplicate: duplicates,
            skipped: 0,
            committed: 0,
            warnings: result.warnings.length,
          },
          warnings: result.warnings,
          periodFrom: result.meta.periodFrom,
          periodTo: result.meta.periodTo,
          createdBy: req.user.id,
        },
        rows,
      );
      // The audit row describes the batch, not its contents.
      await req.audit('import_batch', batch.id, null, {
        accountId: batch.accountId,
        bankFormat: batch.bankFormat,
        fileName: batch.fileName,
        fileSha256: batch.fileSha256,
        stats: batch.stats,
      });

      reply.code(201);
      return {
        batch: toImportBatchDto(batch),
        account: toAccountDto(account),
        accountMatch,
        detection: { parserId: detection.parserId, confidence: detection.confidence },
      };
    },
  );

  app.get(
    '/v1/orgs/:orgId/imports',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listImports',
        tags: ['imports'],
        summary: 'Import batches, newest first',
        params: OrgParams,
        querystring: PaginationQuery,
        response: { 200: ImportBatchList, default: problemResponse },
      },
    },
    async (req) => {
      const { limit } = req.query;
      const after = decodeCursor(req.query.cursor, BatchCursor);
      const rows = await listImportBatches(app.db, req.params.orgId, {
        after: after && { createdAt: new Date(after.c), id: after.id },
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toImportBatchDto),
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ c: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    },
  );

  app.get(
    '/v1/orgs/:orgId/imports/:batchId',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getImport',
        tags: ['imports'],
        summary: 'One import batch with its bank account',
        params: ImportBatchParams,
        response: { 200: ImportBatchDetail, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, batchId } = req.params;
      const batch = await getImportBatch(app.db, orgId, batchId);
      if (!batch) throw new HttpProblem(404, 'not_found', 'Import not found.');
      const account = await getAccount(app.db, orgId, batch.accountId);
      if (!account) throw new Error('import batch without its account');
      return { batch: toImportBatchDto(batch), account: toAccountDto(account) };
    },
  );

  app.get(
    '/v1/orgs/:orgId/imports/:batchId/rows',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listImportRows',
        tags: ['imports'],
        summary: 'Parsed rows of a batch in statement order (the preview)',
        params: ImportBatchParams,
        querystring: ListImportRowsQuery,
        response: { 200: ImportRowList, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, batchId } = req.params;
      const { limit, status } = req.query;
      if (!(await getImportBatch(app.db, orgId, batchId))) {
        throw new HttpProblem(404, 'not_found', 'Import not found.');
      }
      const after = decodeCursor(req.query.cursor, RowCursor);
      const rows = await listImportRows(app.db, orgId, batchId, {
        afterIndex: after?.i,
        limit: limit + 1,
        ...(status ? { status } : {}),
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toImportRowDto),
        nextCursor: rows.length > limit && last ? encodeCursor({ i: last.rowIndex }) : null,
      };
    },
  );

  app.patch(
    '/v1/orgs/:orgId/imports/:batchId/rows/:rowId',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'updateImportRow',
        tags: ['imports'],
        summary: 'Choose the account a preview row books against, or skip it',
        headers: MutationHeaders,
        params: ImportRowParams,
        body: UpdateImportRowRequest,
        response: { 200: ImportRowView, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, batchId, rowId } = req.params;
      const batch = await lockPreviewBatch(req.tx, orgId, batchId);
      const row = await getImportRow(req.tx, orgId, batchId, rowId);
      if (!row) throw new HttpProblem(404, 'not_found', 'Import row not found.');
      if (row.status === 'duplicate') {
        throw new HttpProblem(409, 'conflict', 'A duplicate row is never booked.');
      }

      const patch: Parameters<typeof updateImportRow>[3] = {};
      const { accountId, skip } = req.body;
      if (accountId !== undefined) {
        if (accountId !== null) {
          const account = await getAccount(req.tx, orgId, accountId);
          assertBookable(account, batch.accountId, row.currency);
        }
        patch.chosenAccountId = accountId;
      }
      if (skip !== undefined) patch.status = skip ? 'skipped' : 'new';

      const updated = await updateImportRow(req.tx, orgId, row.id, patch);
      const stats = statsAfter(batch.stats, [{ from: row.status, to: updated.status }]);
      if (stats !== batch.stats) await updateImportBatch(req.tx, orgId, batchId, { stats });
      await req.audit(
        'import_row',
        row.id,
        { status: row.status, chosenAccountId: row.chosenAccountId },
        { status: updated.status, chosenAccountId: updated.chosenAccountId },
      );
      return toImportRowDto(updated);
    },
  );

  await app.register(previewActionRoutes);
  await app.register(commitRoutes, { deps: opts.deps });
};
