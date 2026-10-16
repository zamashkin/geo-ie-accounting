// Declarations and dashboard, computed on request from the ledger with packages/domain
// (docs/MVP.md: no stored or filed declarations yet).
import {
  DashboardQuery,
  DashboardResponse,
  DeclarationYearResponse,
  OrgParams,
  YearQuery,
} from '@ie-ledger/contracts';
import { getOrganizationForUser, listSbsIncomeEntries, type Db } from '@ie-ledger/db';
import {
  annualLimitStatus,
  annualLimitUsageBp,
  computeDeclarationYear,
  ruleSetFor,
} from '@ie-ledger/domain';
import { tbilisiDate } from '@ie-ledger/nbg';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import type { LedgerDeps } from '../ledger-deps';

/** The year's figures plus the limit status, which needs to know about the previous year. */
async function declarationYear(db: Db, orgId: string, userId: string, year: number) {
  const org = await getOrganizationForUser(db, orgId, userId);
  if (!org) throw new HttpProblem(404, 'not_found', 'Organization not found.');
  const sbsEffectiveFrom = org.sbsEffectiveFrom;
  const [entries, previousEntries] = await Promise.all([
    listSbsIncomeEntries(db, orgId, year),
    listSbsIncomeEntries(db, orgId, year - 1),
  ]);
  const figures = computeDeclarationYear({ year, entries, sbsEffectiveFrom });
  const previous = computeDeclarationYear({
    year: year - 1,
    entries: previousEntries,
    sbsEffectiveFrom,
  });
  const rules = ruleSetFor(`${String(year).padStart(4, '0')}-12-01`);
  return {
    figures,
    sbsEffectiveFrom,
    previousYearLimitExceeded: previous.limitExceeded,
    limitStatus: annualLimitStatus(figures.totalIncomeGelMinor, previous.limitExceeded, rules),
    annualLimitGelMinor: rules.annualLimitGelMinor.value,
    annualLimitUsedBp: annualLimitUsageBp(figures.totalIncomeGelMinor, rules),
  };
}

export const reportRoutes: FastifyPluginAsyncZod<{ deps: LedgerDeps }> = async (app, opts) => {
  app.get(
    '/v1/orgs/:orgId/declarations',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getDeclarationYear',
        tags: ['declarations'],
        summary: 'Monthly SBS declaration figures for a year, laid out like the return',
        description:
          'Per month: line 15 (`ytdGelMinor`), lines 18–21 (`byPaymentMethod`), rate, tax and ' +
          'deadline. Computed from posted transactions on every request; nothing is filed.',
        params: OrgParams,
        querystring: YearQuery,
        response: { 200: DeclarationYearResponse, default: problemResponse },
      },
    },
    async (req) => {
      const y = await declarationYear(app.db, req.params.orgId, req.user.id, req.query.year);
      return {
        ...y.figures,
        months: [...y.figures.months],
        limitStatus: y.limitStatus,
        sbsEffectiveFrom: y.sbsEffectiveFrom,
        annualLimitGelMinor: y.annualLimitGelMinor,
        annualLimitUsedBp: y.annualLimitUsedBp,
        previousYearLimitExceeded: y.previousYearLimitExceeded,
      };
    },
  );

  app.get(
    '/v1/orgs/:orgId/dashboard',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getDashboard',
        tags: ['dashboard'],
        summary: 'Year-to-date SBS income, latest month, next deadline and limit progress',
        params: OrgParams,
        querystring: DashboardQuery,
        response: { 200: DashboardResponse, default: problemResponse },
      },
    },
    async (req) => {
      const today = tbilisiDate(opts.deps.now());
      const year = req.query.year ?? Number(today.slice(0, 4));
      const y = await declarationYear(app.db, req.params.orgId, req.user.id, year);
      const months = y.figures.months;
      const latest = months.findLast((m) => m.incomeGelMinor !== 0n) ?? null;
      const next = months.find((m) => m.filingRequired && m.deadline >= today) ?? null;
      return {
        year,
        sbsEffectiveFrom: y.sbsEffectiveFrom,
        annualLimitGelMinor: y.annualLimitGelMinor,
        annualLimitUsedBp: y.annualLimitUsedBp,
        ytdIncomeGelMinor: y.figures.totalIncomeGelMinor,
        limitStatus: y.limitStatus,
        latestMonth: latest,
        nextDeadline: next && {
          period: next.period,
          deadline: next.deadline,
          taxGelMinor: next.taxGelMinor,
          zeroReturn: next.zeroReturn,
        },
        months: months.map((m) => ({
          period: m.period,
          incomeGelMinor: m.incomeGelMinor,
          taxGelMinor: m.taxGelMinor,
          rateBp: m.rateBp,
        })),
      };
    },
  );
};
