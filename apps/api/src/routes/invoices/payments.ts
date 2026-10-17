// Payment matching (WS-09): incoming imported bank lines that could pay an invoice, confirm and
// undo a match, and the "possible invoice" hints on a transaction and on an import preview.
// Scoring is packages/domain (scorePaymentMatch). Allocations never touch the ledger.
import {
  ImportBatchParams,
  ImportInvoiceHints,
  InvoiceParams,
  InvoicePaymentParams,
  InvoiceView,
  MatchPaymentRequest,
  MutationHeaders,
  PaymentSuggestionList,
  TransactionInvoiceHints,
  TransactionParams,
  type InvoiceHint,
} from '@geo-ie-accounting/contracts';
import {
  deleteInvoicePayment,
  getImportBatch,
  getInvoice,
  getTransaction,
  insertInvoicePayment,
  invoicePaidTotal,
  listImportRows,
  listIncomingPayments,
  listOpenInvoices,
  listTransactionAllocations,
  lockInvoice,
  lockTransaction,
  updateInvoice,
  type DbOrTx,
  type OpenInvoice,
} from '@geo-ie-accounting/db';
import {
  compareMatches,
  invoiceOutstanding,
  isFullyPaid,
  scorePaymentMatch,
  type MatchablePayment,
} from '@geo-ie-accounting/domain';
import { tbilisiDate } from '@geo-ie-accounting/nbg';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import type { LedgerDeps } from '../ledger-deps';
import { loadInvoiceView } from './model';

const MAX_SUGGESTIONS = 20;
const MAX_TRANSACTION_HINTS = 5;
const MAX_ROW_HINTS = 3;

/** Open invoices that `payment` could pay, best first. */
function hintsFor(payment: MatchablePayment, open: readonly OpenInvoice[]): InvoiceHint[] {
  const scored: { hint: InvoiceHint; match: NonNullable<ReturnType<typeof scorePaymentMatch>> }[] =
    [];
  for (const inv of open) {
    const outstandingMinor = invoiceOutstanding(inv.totalMinor, inv.paidMinor);
    const match = scorePaymentMatch(
      {
        currency: inv.currency,
        outstandingMinor,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        clientName: inv.clientName,
      },
      payment,
    );
    if (!match) continue;
    scored.push({
      match,
      hint: {
        invoiceId: inv.id,
        number: inv.number,
        clientName: inv.clientName,
        currency: inv.currency,
        outstandingMinor,
        dueDate: inv.dueDate,
        ...match,
      },
    });
  }
  return scored
    .sort((a, b) =>
      compareMatches(
        { match: a.match, occurredOn: a.hint.dueDate ?? '' },
        { match: b.match, occurredOn: b.hint.dueDate ?? '' },
      ),
    )
    .map((s) => s.hint);
}

export const paymentRoutes: FastifyPluginAsyncZod<{ deps: LedgerDeps }> = async (app, opts) => {
  const today = () => tbilisiDate(opts.deps.now());

  async function view(db: DbOrTx, orgId: string, invoiceId: string): Promise<InvoiceView> {
    const v = await loadInvoiceView(db, orgId, invoiceId, today());
    if (!v) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
    return v;
  }

  app.get(
    '/v1/orgs/:orgId/invoices/:invoiceId/payment-suggestions',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listPaymentSuggestions',
        tags: ['invoices'],
        summary: 'Incoming imported bank lines that could pay this invoice, best first',
        description:
          'Only for an issued invoice. A line qualifies in the invoice currency, on or after ' +
          'the issue date, for the amount owed or part of it (or more, for several invoices), ' +
          'from a counterparty like the client name; an exact amount needs no counterparty. ' +
          'Lines already fully allocated or reversed are left out.',
        params: InvoiceParams,
        response: { 200: PaymentSuggestionList, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, invoiceId } = req.params;
      const inv = await getInvoice(app.db, orgId, invoiceId);
      if (!inv) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
      if (inv.status !== 'issued' || !inv.issueDate) return { items: [] };
      const invoice = {
        currency: inv.currency,
        outstandingMinor: invoiceOutstanding(inv.totalMinor, inv.paidMinor),
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        clientName: inv.clientName,
      };
      const payments = await listIncomingPayments(app.db, orgId, {
        currency: inv.currency,
        from: inv.issueDate,
      });
      const items = payments
        .map((p) => {
          const unallocatedMinor = p.amountMinor - p.allocatedMinor;
          const match = scorePaymentMatch(invoice, {
            currency: p.currency,
            availableMinor: unallocatedMinor,
            occurredOn: p.occurredOn,
            counterparty: p.counterparty,
          });
          return match && { p, match, unallocatedMinor, occurredOn: p.occurredOn };
        })
        .filter((x) => x !== null)
        .sort(compareMatches)
        .slice(0, MAX_SUGGESTIONS);
      return {
        items: items.map(({ p, match, unallocatedMinor }) => ({
          transactionId: p.transactionId,
          occurredOn: p.occurredOn,
          amountMinor: p.amountMinor,
          currency: p.currency,
          unallocatedMinor,
          counterparty: p.counterparty,
          description: p.description,
          ...match,
        })),
      };
    },
  );

  app.post(
    '/v1/orgs/:orgId/invoices/:invoiceId/match-payment',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'matchInvoicePayment',
        tags: ['invoices'],
        summary: 'Allocate an incoming imported bank line to an issued invoice',
        description:
          'Default amount: the smaller of what is unallocated on the line and what the invoice ' +
          'still owes. The invoice becomes `paid` once its payments cover the total. Nothing ' +
          'is booked: the receipt is already in the ledger.',
        headers: MutationHeaders,
        params: InvoiceParams,
        body: MatchPaymentRequest,
        response: { 200: InvoiceView, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, invoiceId } = req.params;
      const { transactionId } = req.body;
      const inv = await lockInvoice(req.tx, orgId, invoiceId);
      if (!inv) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
      if (inv.status === 'paid') throw new HttpProblem(409, 'conflict', 'This invoice is paid.');
      if (inv.status !== 'issued') {
        throw new HttpProblem(409, 'conflict', 'Only an issued invoice can be paid.');
      }
      // Serialises allocations of the same bank line across invoices.
      if (!(await lockTransaction(req.tx, orgId, transactionId))) {
        throw new HttpProblem(422, 'validation_failed', 'The transaction does not exist.');
      }
      const [payment] = await listIncomingPayments(req.tx, orgId, { transactionId });
      if (!payment) {
        throw new HttpProblem(
          422,
          'validation_failed',
          'Only an incoming imported bank line that is not reversed or fully allocated can pay an invoice.',
        );
      }
      if (payment.currency !== inv.currency) {
        throw new HttpProblem(
          422,
          'validation_failed',
          `The payment is in ${payment.currency}, the invoice in ${inv.currency}.`,
        );
      }
      const paid = await invoicePaidTotal(req.tx, orgId, invoiceId);
      const outstanding = invoiceOutstanding(inv.totalMinor, paid);
      const available = payment.amountMinor - payment.allocatedMinor;
      const amountMinor =
        req.body.amountMinor ?? (available < outstanding ? available : outstanding);
      if (amountMinor > available) {
        throw new HttpProblem(422, 'validation_failed', 'More than is left of the payment.', [
          { path: 'body/amountMinor', message: 'More than is left of the payment' },
        ]);
      }
      if (amountMinor > outstanding) {
        throw new HttpProblem(422, 'validation_failed', 'More than the invoice still owes.', [
          { path: 'body/amountMinor', message: 'More than the invoice still owes' },
        ]);
      }
      const row = await insertInvoicePayment(req.tx, orgId, {
        invoiceId,
        transactionId,
        amountMinor,
      });
      const nowPaid = isFullyPaid(inv.totalMinor, paid + amountMinor);
      if (nowPaid) await updateInvoice(req.tx, orgId, invoiceId, { status: 'paid' });
      await req.audit(
        'invoice_payment',
        `${invoiceId}:${transactionId}`,
        null,
        { ...row, invoiceStatus: nowPaid ? 'paid' : inv.status },
        { action: 'match' },
      );
      return view(req.tx, orgId, invoiceId);
    },
  );

  app.delete(
    '/v1/orgs/:orgId/invoices/:invoiceId/payments/:transactionId',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'unmatchInvoicePayment',
        tags: ['invoices'],
        summary: 'Undo a payment match',
        description: 'A paid invoice goes back to `issued` when the rest no longer covers it.',
        headers: MutationHeaders,
        params: InvoicePaymentParams,
        response: { 200: InvoiceView, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, invoiceId, transactionId } = req.params;
      const inv = await lockInvoice(req.tx, orgId, invoiceId);
      if (!inv) throw new HttpProblem(404, 'not_found', 'Invoice not found.');
      const removed = await deleteInvoicePayment(req.tx, orgId, invoiceId, transactionId);
      if (!removed) throw new HttpProblem(404, 'not_found', 'This payment is not matched here.');
      const paid = await invoicePaidTotal(req.tx, orgId, invoiceId);
      const reopened = inv.status === 'paid' && !isFullyPaid(inv.totalMinor, paid);
      if (reopened) await updateInvoice(req.tx, orgId, invoiceId, { status: 'issued' });
      await req.audit('invoice_payment', `${invoiceId}:${transactionId}`, removed, null, {
        action: 'unmatch',
      });
      return view(req.tx, orgId, invoiceId);
    },
  );

  app.get(
    '/v1/orgs/:orgId/transactions/:transactionId/invoice-hints',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getTransactionInvoiceHints',
        tags: ['invoices'],
        summary: 'Invoices a transaction pays, and open invoices it could pay',
        params: TransactionParams,
        response: { 200: TransactionInvoiceHints, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, transactionId } = req.params;
      const tx = await getTransaction(app.db, orgId, transactionId);
      if (!tx) throw new HttpProblem(404, 'not_found', 'Transaction not found.');
      const [allocations, [incoming]] = await Promise.all([
        listTransactionAllocations(app.db, orgId, transactionId),
        listIncomingPayments(app.db, orgId, { transactionId }),
      ]);
      let suggestions: InvoiceHint[] = [];
      if (incoming) {
        const open = await listOpenInvoices(app.db, orgId, { currencies: [incoming.currency] });
        const allocatedTo = new Set(allocations.map((a) => a.invoiceId));
        suggestions = hintsFor(
          {
            currency: incoming.currency,
            availableMinor: incoming.amountMinor - incoming.allocatedMinor,
            occurredOn: incoming.occurredOn,
            counterparty: incoming.counterparty,
          },
          open.filter((o) => !allocatedTo.has(o.id)),
        ).slice(0, MAX_TRANSACTION_HINTS);
      }
      return { allocations, suggestions };
    },
  );

  app.get(
    '/v1/orgs/:orgId/imports/:batchId/invoice-hints',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getImportInvoiceHints',
        tags: ['imports'],
        summary: 'Incoming rows of an import that look like payments of open invoices',
        description:
          'For each incoming row that is not a duplicate, up to three open invoices it could ' +
          'pay. Match them from the invoice once the statement is committed.',
        params: ImportBatchParams,
        response: { 200: ImportInvoiceHints, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, batchId } = req.params;
      const batch = await getImportBatch(app.db, orgId, batchId);
      if (!batch) throw new HttpProblem(404, 'not_found', 'Import not found.');
      const rows = (await listImportRows(app.db, orgId, batchId, { status: 'new' })).filter(
        (r) => r.amountMinor > 0n,
      );
      if (rows.length === 0) return { items: [] };
      const open = await listOpenInvoices(app.db, orgId, {
        currencies: [...new Set(rows.map((r) => r.currency))],
      });
      if (open.length === 0) return { items: [] };
      const items = rows
        .map((r) => ({
          rowId: r.id,
          invoices: hintsFor(
            {
              currency: r.currency,
              availableMinor: r.amountMinor,
              occurredOn: r.bookedOn,
              counterparty: r.counterparty,
            },
            open,
          ).slice(0, MAX_ROW_HINTS),
        }))
        .filter((x) => x.invoices.length > 0);
      return { items };
    },
  );
};
