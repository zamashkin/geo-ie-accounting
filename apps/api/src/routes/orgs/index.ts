import {
  CreateOrganizationRequest,
  MutationHeaders,
  OrganizationList,
  OrganizationWithRole,
  OrgParams,
  PaginationQuery,
  Uuid,
  type Role,
} from '@ie-ledger/contracts';
import {
  createOrganization,
  getOrganizationForUser,
  listOrganizationsForUser,
  type OrganizationRow,
} from '@ie-ledger/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuth, requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';

export function toOrganizationDto(org: OrganizationRow, role: Role): OrganizationWithRole {
  return {
    id: org.id,
    name: org.name,
    taxId: org.taxId,
    // A DB check constraint pins base_currency to GEL.
    baseCurrency: 'GEL',
    sbsEffectiveFrom: org.sbsEffectiveFrom,
    accountingMethod: org.accountingMethod,
    createdAt: org.createdAt.toISOString(),
    role,
  };
}

/** Cursors are org ids here; anything else is a client error, not a 500. */
function parseCursor(cursor: string | undefined) {
  if (cursor === undefined) return undefined;
  if (!Uuid.safeParse(cursor).success) throw new HttpProblem(400, 'bad_request', 'Invalid cursor.');
  return cursor;
}

export const orgRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/v1/orgs',
    {
      onRequest: requireAuth(),
      schema: {
        operationId: 'createOrganization',
        tags: ['orgs'],
        summary: 'Create an organization; the caller becomes its owner',
        description: 'Seeds the default chart of accounts in the same transaction.',
        headers: MutationHeaders,
        body: CreateOrganizationRequest,
        response: { 201: OrganizationWithRole, default: problemResponse },
      },
    },
    async (req, reply) => {
      const org = await createOrganization(req.tx, req.user.id, req.body);
      const dto = toOrganizationDto(org, 'owner');
      await req.audit('organization', org.id, null, dto, { orgId: org.id });
      reply.code(201);
      return dto;
    },
  );

  app.get(
    '/v1/orgs',
    {
      onRequest: requireAuth(),
      schema: {
        operationId: 'listOrganizations',
        tags: ['orgs'],
        summary: 'Organizations the caller is a member of',
        querystring: PaginationQuery,
        response: { 200: OrganizationList, default: problemResponse },
      },
    },
    async (req) => {
      const { limit } = req.query;
      const rows = await listOrganizationsForUser(app.db, req.user.id, {
        cursor: parseCursor(req.query.cursor),
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map((o) => toOrganizationDto(o, o.role)),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.get(
    '/v1/orgs/:orgId',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getOrganization',
        tags: ['orgs'],
        summary: 'One organization with the caller’s role',
        params: OrgParams,
        response: { 200: OrganizationWithRole, default: problemResponse },
      },
    },
    async (req) => {
      const org = await getOrganizationForUser(app.db, req.params.orgId, req.user.id);
      if (!org) throw new HttpProblem(404, 'not_found', 'Organization not found.');
      return toOrganizationDto(org, org.role);
    },
  );
};
