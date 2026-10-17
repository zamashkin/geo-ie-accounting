// Invoices (WS-09): drafts, issue (gapless number per org and year), void, duplicate, the PDF
// and the outstanding totals. Invoices never post to the ledger: income still comes from the
// bank receipts. Totals, dates and numbers come from packages/domain.
import {
  CreateInvoiceRequest,
  InvoiceList,
  InvoiceParams,
  InvoiceSummary,
  InvoiceSummaryTotals,
  InvoiceView,
  IssueInvoiceRequest,
  ListInvoicesQuery,
  MutationHeaders,
  OrgParams,
  UpdateInvoiceRequest,
  VoidInvoiceRequest,
} from '@geo-ie-accounting/contracts';
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  getOrganization,
  invoicePaidTotal,
  invoiceTotalsByCurrency,
  listAccounts,
  listInvoiceLines,
  listInvoices,
  lockInvoice,
  nextInvoiceSequence,
  replaceInvoiceLines,
  updateInvoice,
  type DbOrTx,
  type InvoicePatch,
  type InvoiceRow,
  type NewInvoiceLine,
} from '@geo-ie-accounting/db';
import {
  assertIssuable,
  computeInvoiceTotals,
  DomainError,
  formatInvoiceNumber,
  resolveIssueDates,
} from '@geo-ie-accounting/domain';
import { tbilisiDate } from '@geo-ie-accounting/nbg';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import { decodeCursor, encodeCursor, isBankAccount } from '../dto';
import type { LedgerDeps } from '../ledger-deps';
import {
  assertCurrency,
  liveSnapshot,
  loadInvoiceView,
  requireBankAccount,
  requireClient,
  toInvoiceSummaryDto,
} from './model';
import { paymentRoutes } from './payments';
import { renderInvoicePdf } from './pdf/render';

const Cursor = z.object({ id: z.uuid() });

/** Domain validation errors (bad quantity, dates, empty invoice) are the caller's to fix. */
function domainProblem<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof DomainError) throw new HttpProblem(422, 'validation_failed', err.message);
    throw err;
  }
}

/** Fields of the audit row: what the invoice is, without the frozen snapshot. */
function auditView(row: InvoiceRow, lines?: readonly NewInvoiceLine[]) {
  const { snapshot: _snapshot, ...rest } = row;
  return lines ? { ...rest, lines } : rest;
}

function assertDraft(row: InvoiceRow) {
  if (row.status !== 'draft') {
    throw new HttpProblem(
      409,
      'conflict',
      'Only a draft can be edited. Duplicate the invoice to change it.',
    );
  }
}

/** The bank account a new invoice prints when none is chosen: one in its currency, with an IBAN. */
async function defaultBankAccountId(db: DbOrTx, orgId: string, currency: string) {
  const accounts = (await listAccounts(db, orgId)).filter(isBankAccount);
  return (
    accounts.find((a) => a.currency === currency && a.iban)?.id ??
    accounts.find((a) => a.iban)?.id ??
    null
  );
}

export const invoiceRoutes: FastifyPluginAsyncZod<{ deps: LedgerDeps }> = async (app, opts) => {
  const today = () => tbilisiDate(opts.deps.now());

  async function view(db: DbOrTx, orgId: string, invoiceId: string) {
    const v = await loadInvoiceView(db, orgId, invoiceId, today());
    if (!v) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
    return v;
  }

  app.get(
    '/v1/orgs/:orgId/invoices',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listInvoices',
        tags: ['invoices'],
        summary: 'Invoices, newest first, with what each still owes',
        description: '`status=overdue`: issued and past the due date (Tbilisi today).',
        params: OrgParams,
        querystring: ListInvoicesQuery,
        response: { 200: InvoiceList, default: problemResponse },
      },
    },
    async (req) => {
      const { status, clientId, limit } = req.query;
      const after = decodeCursor(req.query.cursor, Cursor);
      const day = today();
      const rows = await listInvoices(
        app.db,
        req.params.orgId,
        {
          clientId,
          ...(status === 'overdue' ? { overdueBefore: day } : status ? { status } : {}),
        },
        { afterId: after?.id, limit },
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => toInvoiceSummaryDto(r, day)),
        nextCursor: rows.length > limit && last ? encodeCursor({ id: last.id }) : null,
      };
    },
  );

  app.get(
    '/v1/orgs/:orgId/invoices/summary',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getInvoiceSummary',
        tags: ['invoices'],
        summary: 'What issued invoices still owe and how much is overdue, per currency',
        params: OrgParams,
        response: { 200: InvoiceSummaryTotals, default: problemResponse },
      },
    },
    async (req) => {
      const day = today();
      const { byCurrency, draftCount } = await invoiceTotalsByCurrency(
        app.db,
        req.params.orgId,
        day,
      );
      return {
        today: day,
        byCurrency,
        outstandingCount: byCurrency.reduce((n, c) => n + c.outstandingCount, 0),
        overdueCount: byCurrency.reduce((n, c) => n + c.overdueCount, 0),
        draftCount,
      };
    },
  );

  app.get(
    '/v1/orgs/:orgId/invoices/:invoiceId',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getInvoice',
        tags: ['invoices'],
        summary: 'One invoice with its lines, payments and printed details',
        params: InvoiceParams,
        response: { 200: InvoiceView, default: problemResponse },
      },
    },
    async (req) => view(app.db, req.params.orgId, req.params.invoiceId),
  );

  app.post(
    '/v1/orgs/:orgId/invoices',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'createInvoice',
        tags: ['invoices'],
        summary: 'Create a draft invoice',
        description:
          'Currency defaults to the client’s; the bank account to one in that currency with ' +
          'an IBAN. Dates are optional until the invoice is issued. No VAT.',
        headers: MutationHeaders,
        params: OrgParams,
        body: CreateInvoiceRequest,
        response: { 201: InvoiceView, default: problemResponse },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      const b = req.body;
      const client = await requireClient(req.tx, orgId, b.clientId);
      if (client.archivedAt !== null) {
        throw new HttpProblem(422, 'validation_failed', 'This client is archived.');
      }
      const currency = b.currency ?? client.defaultCurrency;
      assertCurrency(currency, 'body/currency');
      const bankAccountId =
        b.bankAccountId === undefined
          ? await defaultBankAccountId(req.tx, orgId, currency)
          : b.bankAccountId;
      if (bankAccountId) await requireBankAccount(req.tx, orgId, bankAccountId);
      const totals = domainProblem(() => computeInvoiceTotals(currency, b.lines));
      const created = await createInvoice(
        req.tx,
        orgId,
        {
          clientId: client.id,
          currency,
          issueDate: b.issueDate ?? null,
          dueDate: b.dueDate ?? null,
          bankAccountId,
          notes: b.notes ?? null,
          totalMinor: totals.totalMinor,
        },
        b.lines,
      );
      await req.audit('invoice', created.id, null, auditView(created, b.lines));
      reply.code(201);
      return view(req.tx, orgId, created.id);
    },
  );

  app.patch(
    '/v1/orgs/:orgId/invoices/:invoiceId',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'updateInvoice',
        tags: ['invoices'],
        summary: 'Edit a draft invoice',
        description: '`lines` replaces every line. Issued invoices cannot change (409).',
        headers: MutationHeaders,
        params: InvoiceParams,
        body: UpdateInvoiceRequest,
        response: { 200: InvoiceView, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, invoiceId } = req.params;
      const b = req.body;
      const before = await lockInvoice(req.tx, orgId, invoiceId);
      if (!before) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
      assertDraft(before);

      const patch: InvoicePatch = {};
      if (b.clientId !== undefined && b.clientId !== before.clientId) {
        const client = await requireClient(req.tx, orgId, b.clientId);
        if (client.archivedAt !== null) {
          throw new HttpProblem(422, 'validation_failed', 'This client is archived.');
        }
        patch.clientId = client.id;
      }
      if (b.currency !== undefined) {
        assertCurrency(b.currency, 'body/currency');
        patch.currency = b.currency;
      }
      if (b.bankAccountId !== undefined) {
        if (b.bankAccountId) await requireBankAccount(req.tx, orgId, b.bankAccountId);
        patch.bankAccountId = b.bankAccountId;
      }
      if (b.issueDate !== undefined) patch.issueDate = b.issueDate;
      if (b.dueDate !== undefined) patch.dueDate = b.dueDate;
      if (b.notes !== undefined) patch.notes = b.notes;
      const issueDate = patch.issueDate === undefined ? before.issueDate : patch.issueDate;
      const dueDate = patch.dueDate === undefined ? before.dueDate : patch.dueDate;
      if (issueDate && dueDate && dueDate < issueDate) {
        throw new HttpProblem(
          422,
          'validation_failed',
          'The due date cannot be before the issue date.',
          [{ path: 'body/dueDate', message: 'The due date cannot be before the issue date' }],
        );
      }

      const currency = patch.currency ?? before.currency;
      const lines = b.lines ?? (await listInvoiceLines(req.tx, orgId, invoiceId));
      patch.totalMinor = domainProblem(() => computeInvoiceTotals(currency, lines)).totalMinor;
      if (b.lines) await replaceInvoiceLines(req.tx, orgId, invoiceId, b.lines);
      const after = await updateInvoice(req.tx, orgId, invoiceId, patch);
      await req.audit('invoice', invoiceId, auditView(before), auditView(after, b.lines));
      return view(req.tx, orgId, invoiceId);
    },
  );

  app.delete(
    '/v1/orgs/:orgId/invoices/:invoiceId',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'deleteInvoice',
        tags: ['invoices'],
        summary: 'Delete a draft invoice',
        description: 'Issued invoices are never deleted: void them. Returns the deleted draft.',
        headers: MutationHeaders,
        params: InvoiceParams,
        response: { 200: InvoiceSummary, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, invoiceId } = req.params;
      const locked = await lockInvoice(req.tx, orgId, invoiceId);
      if (!locked) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
      if (locked.status !== 'draft') {
        throw new HttpProblem(409, 'conflict', 'Only a draft can be deleted. Void it instead.');
      }
      const row = await getInvoice(req.tx, orgId, invoiceId);
      if (!row) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
      await deleteInvoice(req.tx, orgId, invoiceId);
      await req.audit('invoice', invoiceId, auditView(locked), null);
      return toInvoiceSummaryDto(row, today());
    },
  );

  app.post(
    '/v1/orgs/:orgId/invoices/:invoiceId/issue',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'issueInvoice',
        tags: ['invoices'],
        summary: 'Issue a draft: assign the next number and freeze it',
        description:
          'The number is the next of the issue year for the organization (`2026-001`, with ' +
          'the org prefix), gapless: it is taken in the same transaction, so a failed issue ' +
          'gives it back. Issue date defaults to today (Tbilisi), due date to issue date + the ' +
          'org’s `invoiceDueDays`. The seller, client and bank details are frozen with it.',
        headers: MutationHeaders,
        params: InvoiceParams,
        body: IssueInvoiceRequest,
        response: { 200: InvoiceView, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, invoiceId } = req.params;
      const before = await lockInvoice(req.tx, orgId, invoiceId);
      if (!before) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
      if (before.status !== 'draft') {
        throw new HttpProblem(409, 'conflict', 'This invoice is already issued.');
      }
      const org = await getOrganization(req.tx, orgId);
      if (!org) throw new HttpProblem(404, 'not_found', 'Organization not found.');
      const lines = await listInvoiceLines(req.tx, orgId, invoiceId);
      const totals = domainProblem(() => assertIssuable(before.currency, lines));
      const dates = domainProblem(() =>
        resolveIssueDates(
          {
            issueDate: req.body.issueDate ?? before.issueDate,
            dueDate: req.body.dueDate ?? before.dueDate,
          },
          today(),
          org.invoiceDueDays,
        ),
      );
      const snapshot = await liveSnapshot(req.tx, orgId, before);
      const year = Number(dates.issueDate.slice(0, 4));
      // Last step before the update: the sequence row stays locked until COMMIT.
      const seq = await nextInvoiceSequence(req.tx, orgId, year);
      const after = await updateInvoice(req.tx, orgId, invoiceId, {
        status: 'issued',
        number: formatInvoiceNumber(org.invoicePrefix, year, seq),
        numberYear: year,
        numberSeq: seq,
        issueDate: dates.issueDate,
        dueDate: dates.dueDate,
        totalMinor: totals.totalMinor,
        snapshot,
        issuedAt: new Date(),
      });
      await req.audit('invoice', invoiceId, auditView(before), auditView(after), {
        action: 'issue',
      });
      return view(req.tx, orgId, invoiceId);
    },
  );

  app.post(
    '/v1/orgs/:orgId/invoices/:invoiceId/void',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'voidInvoice',
        tags: ['invoices'],
        summary: 'Void an issued invoice; it keeps its number',
        description: 'Unmatch its payments first. A draft is deleted instead.',
        headers: MutationHeaders,
        params: InvoiceParams,
        body: VoidInvoiceRequest,
        response: { 200: InvoiceView, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, invoiceId } = req.params;
      const before = await lockInvoice(req.tx, orgId, invoiceId);
      if (!before) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
      if (before.status === 'draft') {
        throw new HttpProblem(409, 'conflict', 'A draft has no number to keep. Delete it.');
      }
      if (before.status === 'void') {
        throw new HttpProblem(409, 'conflict', 'This invoice is already void.');
      }
      if ((await invoicePaidTotal(req.tx, orgId, invoiceId)) > 0n) {
        throw new HttpProblem(409, 'conflict', 'Unmatch the payments of this invoice first.');
      }
      const after = await updateInvoice(req.tx, orgId, invoiceId, {
        status: 'void',
        voidedAt: new Date(),
      });
      await req.audit(
        'invoice',
        invoiceId,
        { status: before.status },
        { status: after.status, reason: req.body.reason ?? null },
        { action: 'void' },
      );
      return view(req.tx, orgId, invoiceId);
    },
  );

  app.post(
    '/v1/orgs/:orgId/invoices/:invoiceId/duplicate',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'duplicateInvoice',
        tags: ['invoices'],
        summary: 'Copy an invoice into a new draft',
        description: 'Same client, currency, bank account, notes and lines; no dates or number.',
        headers: MutationHeaders,
        params: InvoiceParams,
        response: { 201: InvoiceView, default: problemResponse },
      },
    },
    async (req, reply) => {
      const { orgId, invoiceId } = req.params;
      const source = await getInvoice(req.tx, orgId, invoiceId);
      if (!source) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
      const lines = await listInvoiceLines(req.tx, orgId, invoiceId);
      const copy = lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
      }));
      const created = await createInvoice(
        req.tx,
        orgId,
        {
          clientId: source.clientId,
          currency: source.currency,
          issueDate: null,
          dueDate: null,
          bankAccountId: source.bankAccountId,
          notes: source.notes,
          totalMinor: computeInvoiceTotals(source.currency, copy).totalMinor,
        },
        copy,
      );
      await req.audit(
        'invoice',
        created.id,
        null,
        { ...auditView(created, copy), duplicateOf: invoiceId },
        { action: 'duplicate' },
      );
      reply.code(201);
      return view(req.tx, orgId, created.id);
    },
  );

  app.get(
    '/v1/orgs/:orgId/invoices/:invoiceId/pdf',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getInvoicePdf',
        tags: ['invoices'],
        summary: 'The invoice as a PDF, rendered on request',
        description:
          'Rendered synchronously on every request (ADR 0015); nothing is stored. A draft ' +
          'prints a DRAFT mark and a void invoice a VOID mark. `inline=true` opens it in the ' +
          'browser instead of downloading it.',
        params: InvoiceParams,
        querystring: z.object({ inline: z.enum(['true', 'false']).optional() }),
        response: {
          200: {
            description: 'The invoice PDF',
            content: { 'application/pdf': { schema: z.string().meta({ format: 'binary' }) } },
          },
          default: problemResponse,
        },
      },
    },
    async (req, reply) => {
      const invoice = await view(app.db, req.params.orgId, req.params.invoiceId);
      const pdf = await renderInvoicePdf(invoice);
      const name = `${invoice.number ?? `draft-${invoice.id.slice(0, 8)}`}.pdf`.replace(
        /[^A-Za-z0-9._-]/g,
        '_',
      );
      const disposition = req.query.inline === 'true' ? 'inline' : 'attachment';
      return (
        reply
          .type('application/pdf')
          .header('content-disposition', `${disposition}; filename="${name}"`)
          .header('cache-control', 'private, no-store')
          // Fastify sends a Buffer as is; the type follows the documented `string` (binary) schema.
          .send(pdf as unknown as string)
      );
    },
  );

  await app.register(paymentRoutes, { deps: opts.deps });
};
