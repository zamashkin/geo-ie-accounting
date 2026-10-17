import {
  CreateTransactionRequest,
  ListTransactionsQuery,
  MutationHeaders,
  OrgParams,
  ReverseTransactionRequest,
  TransactionList,
  TransactionParams,
  TransactionPreview,
  TransactionView,
} from '@geo-ie-accounting/contracts';
import {
  getTransaction,
  insertTransaction,
  listAccounts,
  listTransactions,
  lockTransaction,
  resolveRate,
  type ExchangeRateRow,
} from '@geo-ie-accounting/db';
import { reverse } from '@geo-ie-accounting/domain';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import { decodeCursor, encodeCursor, toTransactionDto } from '../dto';
import type { LedgerDeps } from '../ledger-deps';
import { buildManualDraft, currenciesNeeded, LedgerAccounts, toPreview } from './manual';

const Cursor = z.object({ d: z.iso.date(), id: z.uuid() });

/** Rates resolved before the request transaction (NBG may be asked), by currency. */
const resolvedRates = new WeakMap<FastifyRequest, Map<string, ExchangeRateRow>>();

export const transactionRoutes: FastifyPluginAsyncZod<{ deps: LedgerDeps }> = async (app, opts) => {
  const { deps } = opts;

  /** Raw postings are the owner's; everyone else books through the event types. */
  function assertMayBook(req: FastifyRequest, body: CreateTransactionRequest) {
    if (body.type === 'postings' && req.membership.role !== 'owner') {
      throw new HttpProblem(403, 'forbidden', 'Only the owner can enter raw postings.');
    }
  }

  /**
   * NBG rate of every foreign currency of the transaction on its date. Uses the pool and may
   * call NBG, so it runs before the request transaction (like the import commit).
   */
  async function resolveRates(req: FastifyRequest, body: CreateTransactionRequest) {
    const accounts = new LedgerAccounts(await listAccounts(app.db, req.membership.orgId));
    const rates = new Map<string, ExchangeRateRow>();
    for (const currency of currenciesNeeded(body, accounts)) {
      try {
        rates.set(
          currency,
          await resolveRate(app.db, deps.rates, currency, body.occurredOn, deps.now()),
        );
      } catch (err) {
        req.log.warn({ err, currency, date: body.occurredOn }, 'NBG rate could not be resolved');
        throw new HttpProblem(
          503,
          'rate_unavailable',
          `The NBG rate for ${currency} on ${body.occurredOn} is not available. Try again later.`,
        );
      }
    }
    return { accounts, rates };
  }

  app.post(
    '/v1/orgs/:orgId/transactions/preview',
    {
      onRequest: requireRole('accountant'),
      // Books nothing: no transaction, audit row or idempotency key.
      config: { tx: false },
      schema: {
        operationId: 'previewTransaction',
        tags: ['transactions'],
        summary: 'What a manual transaction would book, with GEL equivalents, without booking',
        description:
          'Same body and checks as `POST /transactions`. A missing NBG rate is `503 ' +
          'rate_unavailable`.',
        params: OrgParams,
        body: CreateTransactionRequest,
        response: { 200: TransactionPreview, default: problemResponse },
      },
    },
    async (req) => {
      assertMayBook(req, req.body);
      const { accounts, rates } = await resolveRates(req, req.body);
      return toPreview(buildManualDraft(req.body, accounts, rates), accounts, rates);
    },
  );

  app.post(
    '/v1/orgs/:orgId/transactions',
    {
      onRequest: requireRole('accountant'),
      preHandler: async (req) => {
        assertMayBook(req, req.body);
        resolvedRates.set(req, (await resolveRates(req, req.body)).rates);
      },
      schema: {
        operationId: 'createTransaction',
        tags: ['transactions'],
        summary: 'Book a manual transaction from one of the canonical events',
        description:
          'Income receipt, expense, owner draw or contribution, transfer, currency exchange or ' +
          'tax payment; `postings` (raw, signed, balanced per currency) is for the owner only. ' +
          'Every posting is converted to GEL at the NBG rate of `occurredOn`; a missing rate ' +
          'is `503 rate_unavailable`. Source `manual`.',
        headers: MutationHeaders,
        params: OrgParams,
        body: CreateTransactionRequest,
        response: { 201: TransactionView, default: problemResponse },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      const rates = resolvedRates.get(req) ?? new Map<string, ExchangeRateRow>();
      // Re-read inside the transaction: an account archived since the preHandler is refused.
      const accounts = new LedgerAccounts(await listAccounts(req.tx, orgId));
      const needed = currenciesNeeded(req.body, accounts);
      if (needed.some((c) => !rates.has(c))) {
        throw new HttpProblem(409, 'conflict', 'The accounts changed while booking. Retry.');
      }
      const draft = buildManualDraft(req.body, accounts, rates);
      const created = await insertTransaction(req.tx, orgId, req.user.id, draft);
      const view = await getTransaction(req.tx, orgId, created.id);
      if (!view) throw new Error('transaction missing after insert');
      await req.audit('transaction', created.id, null, {
        source: created.source,
        type: req.body.type,
        occurredOn: created.occurredOn,
        paymentMethod: created.paymentMethod,
        postings: draft.postings,
      });
      reply.code(201);
      return toTransactionDto(view);
    },
  );
  app.get(
    '/v1/orgs/:orgId/transactions',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listTransactions',
        tags: ['transactions'],
        summary: 'Transactions with postings, GEL equivalents and NBG rates, newest first',
        params: OrgParams,
        querystring: ListTransactionsQuery,
        response: { 200: TransactionList, default: problemResponse },
      },
    },
    async (req) => {
      const { limit, from, to, accountId, source, q, taxable } = req.query;
      const after = decodeCursor(req.query.cursor, Cursor);
      const rows = await listTransactions(
        app.db,
        req.params.orgId,
        { from, to, accountId, source, text: q, taxableOnly: taxable === 'true' },
        { after: after && { occurredOn: after.d, id: after.id }, limit },
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toTransactionDto),
        nextCursor:
          rows.length > limit && last ? encodeCursor({ d: last.occurredOn, id: last.id }) : null,
      };
    },
  );

  app.get(
    '/v1/orgs/:orgId/transactions/:transactionId',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getTransaction',
        tags: ['transactions'],
        summary: 'One transaction with its postings and rates',
        params: TransactionParams,
        response: { 200: TransactionView, default: problemResponse },
      },
    },
    async (req) => {
      const t = await getTransaction(app.db, req.params.orgId, req.params.transactionId);
      if (!t) throw new HttpProblem(404, 'not_found', 'Transaction not found.');
      return toTransactionDto(t);
    },
  );

  app.post(
    '/v1/orgs/:orgId/transactions/:transactionId/reverse',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'reverseTransaction',
        tags: ['transactions'],
        summary: 'Post the reversing transaction (every posting negated)',
        description:
          'Posted transactions never change; a reversal is the only correction. Same accounts, ' +
          'rates and payment method, so the SBS income it posted comes back out. Send `{}` for ' +
          'the defaults.',
        headers: MutationHeaders,
        params: TransactionParams,
        body: ReverseTransactionRequest,
        response: { 201: TransactionView, default: problemResponse },
      },
    },
    async (req, reply) => {
      const { orgId, transactionId } = req.params;
      // The lock serialises concurrent reversals; the unique index on reverses_id backs it up.
      const locked = await lockTransaction(req.tx, orgId, transactionId);
      if (!locked) throw new HttpProblem(404, 'not_found', 'Transaction not found.');
      if (locked.source === 'reversal') {
        throw new HttpProblem(409, 'conflict', 'A reversal cannot be reversed.');
      }
      const original = await getTransaction(req.tx, orgId, transactionId);
      if (!original) throw new HttpProblem(404, 'not_found', 'Transaction not found.');
      if (original.reversedById) {
        throw new HttpProblem(409, 'conflict', 'This transaction is already reversed.');
      }

      const draft = reverse(original, {
        ...(req.body.occurredOn ? { occurredOn: req.body.occurredOn } : {}),
        ...(req.body.description ? { description: req.body.description } : {}),
      });
      const created = await insertTransaction(req.tx, orgId, req.user.id, draft);
      const view = await getTransaction(req.tx, orgId, created.id);
      if (!view) throw new Error('reversal missing after insert');
      await req.audit(
        'transaction',
        created.id,
        null,
        { reversesId: transactionId, occurredOn: created.occurredOn, postings: draft.postings },
        { action: 'reverse' },
      );
      reply.code(201);
      return toTransactionDto(view);
    },
  );
};
