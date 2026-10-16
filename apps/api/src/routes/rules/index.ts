// Categorisation rules (WS-07): CRUD and ordering under /v1/orgs/:orgId/rules. Matching is
// packages/domain (findMatchingRule); upload and apply-rules use it (routes/imports/suggest.ts).
import {
  CategorizationRule,
  CreateRuleRequest,
  MutationHeaders,
  OrgParams,
  ReorderRulesRequest,
  RuleList,
  RuleParams,
  UpdateRuleRequest,
} from '@ie-ledger/contracts';
import {
  createRule,
  deleteRule,
  getAccount,
  getRule,
  listRules,
  setRuleOrder,
  updateRule,
  type DbOrTx,
  type RuleRow,
} from '@ie-ledger/db';
import { hasAnyCondition } from '@ie-ledger/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import { toRuleDto } from '../dto';

type RuleValues = Omit<RuleRow, 'id' | 'orgId' | 'priority' | 'createdAt' | 'updatedAt'>;

const invalid = (path: string, message: string) =>
  new HttpProblem(422, 'validation_failed', message, [{ path: `body/${path}`, message }]);

/** Checks a complete rule (after a PATCH is merged) against the org's accounts. */
async function assertValidRule(db: DbOrTx, orgId: string, rule: RuleValues) {
  if (!hasAnyCondition(rule)) {
    throw invalid(
      'counterpartyContains',
      'Set at least one condition, or the rule would match every line.',
    );
  }
  for (const key of ['amountMinMinor', 'amountMaxMinor'] as const) {
    const bound = rule[key];
    if (bound !== null && bound < 0n) {
      throw invalid(key, 'Amounts are compared without sign: use a positive bound.');
    }
  }
  const { amountMinMinor: min, amountMaxMinor: max } = rule;
  if (min !== null || max !== null) {
    if (!rule.currency) throw invalid('currency', 'An amount range needs a currency.');
    if (min !== null && max !== null && min > max) {
      throw invalid('amountMaxMinor', 'The upper bound is below the lower one.');
    }
  }
  const account = await getAccount(db, orgId, rule.targetAccountId);
  if (!account || account.archivedAt) throw invalid('targetAccountId', 'Account not found.');
  if (rule.currency && account.currency !== null && account.currency !== rule.currency) {
    throw invalid(
      'targetAccountId',
      `The account is in ${account.currency}, the rule matches ${rule.currency} lines.`,
    );
  }
}

export const ruleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/v1/orgs/:orgId/rules',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listRules',
        tags: ['rules'],
        summary: 'Categorisation rules in the order they are tried',
        params: OrgParams,
        response: { 200: RuleList, default: problemResponse },
      },
    },
    async (req) => ({ items: (await listRules(app.db, req.params.orgId)).map(toRuleDto) }),
  );

  app.get(
    '/v1/orgs/:orgId/rules/:ruleId',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getRule',
        tags: ['rules'],
        summary: 'One categorisation rule',
        params: RuleParams,
        response: { 200: CategorizationRule, default: problemResponse },
      },
    },
    async (req) => {
      const rule = await getRule(app.db, req.params.orgId, req.params.ruleId);
      if (!rule) throw new HttpProblem(404, 'not_found', 'Rule not found.');
      return toRuleDto(rule);
    },
  );

  app.post(
    '/v1/orgs/:orgId/rules',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'createRule',
        tags: ['rules'],
        summary: 'Create a categorisation rule (tried after the existing ones)',
        description:
          'New uploads apply it straight away; open previews pick it up with ' +
          '`POST /imports/:batchId/apply-rules`.',
        headers: MutationHeaders,
        params: OrgParams,
        body: CreateRuleRequest,
        response: { 201: CategorizationRule, default: problemResponse },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      const b = req.body;
      const values: RuleValues = {
        name: b.name,
        counterpartyContains: b.counterpartyContains ?? null,
        descriptionContains: b.descriptionContains ?? null,
        direction: b.direction ?? null,
        currency: b.currency ?? null,
        amountMinMinor: b.amountMinMinor ?? null,
        amountMaxMinor: b.amountMaxMinor ?? null,
        targetAccountId: b.targetAccountId,
        isActive: b.isActive ?? true,
      };
      await assertValidRule(req.tx, orgId, values);
      const created = await createRule(req.tx, orgId, values);
      await req.audit('categorization_rule', created.id, null, created);
      reply.code(201);
      return toRuleDto(created);
    },
  );

  app.patch(
    '/v1/orgs/:orgId/rules/:ruleId',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'updateRule',
        tags: ['rules'],
        summary: 'Change a categorisation rule',
        description: 'Only the fields sent change; null clears a condition.',
        headers: MutationHeaders,
        params: RuleParams,
        body: UpdateRuleRequest,
        response: { 200: CategorizationRule, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, ruleId } = req.params;
      const existing = await getRule(req.tx, orgId, ruleId, { forUpdate: true });
      if (!existing) throw new HttpProblem(404, 'not_found', 'Rule not found.');
      const patch = Object.fromEntries(
        Object.entries(req.body).filter(([, v]) => v !== undefined),
      ) as Partial<RuleValues>;
      const merged: RuleValues = { ...existing, ...patch };
      await assertValidRule(req.tx, orgId, merged);
      const updated = await updateRule(req.tx, orgId, ruleId, patch);
      await req.audit('categorization_rule', ruleId, existing, updated);
      return toRuleDto(updated);
    },
  );

  app.delete(
    '/v1/orgs/:orgId/rules/:ruleId',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'deleteRule',
        tags: ['rules'],
        summary: 'Delete a categorisation rule',
        description: 'Rows it already suggested keep their account. Returns the deleted rule.',
        headers: MutationHeaders,
        params: RuleParams,
        response: { 200: CategorizationRule, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, ruleId } = req.params;
      const existing = await getRule(req.tx, orgId, ruleId, { forUpdate: true });
      if (!existing) throw new HttpProblem(404, 'not_found', 'Rule not found.');
      await deleteRule(req.tx, orgId, ruleId);
      await req.audit('categorization_rule', ruleId, existing, null);
      return toRuleDto(existing);
    },
  );

  app.post(
    '/v1/orgs/:orgId/rules/reorder',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'reorderRules',
        tags: ['rules'],
        summary: 'Set the order the rules are tried in',
        description: 'Send every rule id of the organization, first tried first.',
        headers: MutationHeaders,
        params: OrgParams,
        body: ReorderRulesRequest,
        response: { 200: RuleList, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId } = req.params;
      const { ruleIds } = req.body;
      const before = await listRules(req.tx, orgId);
      const known = new Set(before.map((r) => r.id));
      const sent = new Set(ruleIds);
      if (
        sent.size !== ruleIds.length ||
        sent.size !== known.size ||
        ruleIds.some((id) => !known.has(id))
      ) {
        throw invalid('ruleIds', 'Send every rule id of the organization exactly once.');
      }
      await setRuleOrder(req.tx, orgId, ruleIds);
      await req.audit(
        'categorization_rule',
        null,
        { order: before.map((r) => r.id) },
        { order: ruleIds },
        { action: 'reorder' },
      );
      return { items: (await listRules(req.tx, orgId)).map(toRuleDto) };
    },
  );
};
