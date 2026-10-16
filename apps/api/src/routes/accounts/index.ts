import { AccountList, OrgParams } from '@ie-ledger/contracts';
import { listAccounts } from '@ie-ledger/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../plugins/authz';
import { problemResponse } from '../../problem';
import { toAccountDto } from '../dto';

export const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/v1/orgs/:orgId/accounts',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listAccounts',
        tags: ['accounts'],
        summary: 'Active accounts of the organization (chart of accounts and bank accounts)',
        params: OrgParams,
        response: { 200: AccountList, default: problemResponse },
      },
    },
    async (req) => {
      const rows = await listAccounts(app.db, req.params.orgId);
      return { items: rows.map(toAccountDto) };
    },
  );
};
