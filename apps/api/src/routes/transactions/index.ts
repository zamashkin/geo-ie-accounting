import {
  ListTransactionsQuery,
  MutationHeaders,
  OrgParams,
  ReverseTransactionRequest,
  TransactionList,
  TransactionParams,
  TransactionView,
} from '@ie-ledger/contracts';
import {
  getTransaction,
  insertTransaction,
  listTransactions,
  lockTransaction,
} from '@ie-ledger/db';
import { reverse } from '@ie-ledger/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import { decodeCursor, encodeCursor, toTransactionDto } from '../dto';

const Cursor = z.object({ d: z.iso.date(), id: z.uuid() });

export const transactionRoutes: FastifyPluginAsyncZod = async (app) => {
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
      const { limit, from, to, accountId, source } = req.query;
      const after = decodeCursor(req.query.cursor, Cursor);
      const rows = await listTransactions(
        app.db,
        req.params.orgId,
        { from, to, accountId, source },
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
