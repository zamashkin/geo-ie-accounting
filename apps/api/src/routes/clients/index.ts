// Clients (WS-09): create, edit, archive; each with what its issued invoices still owe.
import {
  ClientList,
  ClientParams,
  ClientView,
  CreateClientRequest,
  ListClientsQuery,
  MutationHeaders,
  OrgParams,
  UpdateClientRequest,
} from '@ie-ledger/contracts';
import {
  clientInvoiceStats,
  createClient,
  getClient,
  listClients,
  updateClient,
  type ClientPatch,
  type ClientRow,
  type ClientInvoiceStats,
} from '@ie-ledger/db';
import { tbilisiDate } from '@ie-ledger/nbg';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import type { LedgerDeps } from '../ledger-deps';
import { assertCurrency, toClientDto } from '../invoices/model';

function toClientView(c: ClientRow, stats: ClientInvoiceStats | undefined): ClientView {
  return {
    ...toClientDto(c),
    invoiceCount: stats?.invoiceCount ?? 0,
    outstanding: stats?.outstanding ?? [],
    overdueCount: stats?.overdueCount ?? 0,
  };
}

export const clientRoutes: FastifyPluginAsyncZod<{ deps: LedgerDeps }> = async (app, opts) => {
  const today = () => tbilisiDate(opts.deps.now());

  app.get(
    '/v1/orgs/:orgId/clients',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listClients',
        tags: ['clients'],
        summary: 'Clients by name, with what their issued invoices still owe',
        description: 'Active clients; `includeArchived=true` adds archived ones.',
        params: OrgParams,
        querystring: ListClientsQuery,
        response: { 200: ClientList, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId } = req.params;
      const [rows, stats] = await Promise.all([
        listClients(app.db, orgId, { includeArchived: req.query.includeArchived === 'true' }),
        clientInvoiceStats(app.db, orgId, today()),
      ]);
      return { items: rows.map((c) => toClientView(c, stats.get(c.id))) };
    },
  );

  app.get(
    '/v1/orgs/:orgId/clients/:clientId',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getClient',
        tags: ['clients'],
        summary: 'One client with what its issued invoices still owe',
        description: 'Its invoices are `GET /invoices?clientId=`.',
        params: ClientParams,
        response: { 200: ClientView, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, clientId } = req.params;
      const client = await getClient(app.db, orgId, clientId);
      if (!client) throw new HttpProblem(404, 'not_found', 'Client not found.');
      const stats = await clientInvoiceStats(app.db, orgId, today(), { clientId });
      return toClientView(client, stats.get(clientId));
    },
  );

  app.post(
    '/v1/orgs/:orgId/clients',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'createClient',
        tags: ['clients'],
        summary: 'Create a client',
        headers: MutationHeaders,
        params: OrgParams,
        body: CreateClientRequest,
        response: { 201: ClientView, default: problemResponse },
      },
    },
    async (req, reply) => {
      const b = req.body;
      assertCurrency(b.defaultCurrency, 'body/defaultCurrency');
      const created = await createClient(req.tx, req.params.orgId, {
        name: b.name,
        taxId: b.taxId ?? null,
        address: b.address ?? null,
        email: b.email ?? null,
        country: b.country,
        defaultCurrency: b.defaultCurrency,
        notes: b.notes ?? null,
      });
      await req.audit('client', created.id, null, toClientDto(created));
      reply.code(201);
      return toClientView(created, undefined);
    },
  );

  app.patch(
    '/v1/orgs/:orgId/clients/:clientId',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'updateClient',
        tags: ['clients'],
        summary: 'Edit, archive or restore a client',
        description:
          'Issued invoices keep the client details they were issued with. Archived clients ' +
          'keep their invoices but are hidden from the pickers.',
        headers: MutationHeaders,
        params: ClientParams,
        body: UpdateClientRequest,
        response: { 200: ClientView, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, clientId } = req.params;
      const before = await getClient(req.tx, orgId, clientId, { forUpdate: true });
      if (!before) throw new HttpProblem(404, 'not_found', 'Client not found.');
      const { archived, ...fields } = req.body;
      if (fields.defaultCurrency !== undefined) {
        assertCurrency(fields.defaultCurrency, 'body/defaultCurrency');
      }
      const patch: ClientPatch = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      );
      if (archived === true && before.archivedAt === null) patch.archivedAt = new Date();
      if (archived === false) patch.archivedAt = null;
      const after = await updateClient(req.tx, orgId, clientId, patch);
      const action =
        patch.archivedAt === undefined ? 'update' : patch.archivedAt ? 'archive' : 'restore';
      await req.audit('client', clientId, toClientDto(before), toClientDto(after), { action });
      const stats = await clientInvoiceStats(req.tx, orgId, today(), { clientId });
      return toClientView(after, stats.get(clientId));
    },
  );
};
