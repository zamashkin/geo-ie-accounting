// Dashboard: year-to-date figures, income by month, counterparty and currency, the limit and
// the return that needs attention first. Aggregated SQL only (packages/db reports.ts): a fixed
// number of queries whatever the number of transactions or months.
import {
  DashboardQuery,
  DashboardView,
  FILING_STATUS_KINDS,
  OrgParams,
  type FilingStatusKind,
} from '@geo-ie-accounting/contracts';
import { sbsIncomeByCounterparty, sbsIncomeByCurrency } from '@geo-ie-accounting/db';
import { tbilisiDate } from '@geo-ie-accounting/nbg';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../plugins/authz';
import { problemResponse } from '../../problem';
import { loadDeclarationYear, type MonthView } from '../declarations/year';
import type { LedgerDeps } from '../ledger-deps';

const NEEDS_ACTION = new Set<FilingStatusKind>(['overdue', 'due', 'filed_with_drift']);

/**
 * The month that needs attention first: the earliest overdue, due or drifted month, else the
 * next month whose deadline is still ahead (the open month, or a later one).
 */
function nextReturn(months: readonly MonthView[], today: string) {
  return (
    months.find((m) => NEEDS_ACTION.has(m.status.kind)) ??
    months.find((m) => m.filingRequired && m.status.kind === 'not_due' && m.deadline >= today) ??
    null
  );
}

export const dashboardRoutes: FastifyPluginAsyncZod<{ deps: LedgerDeps }> = async (app, opts) => {
  app.get(
    '/v1/orgs/:orgId/dashboard',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getDashboard',
        tags: ['dashboard'],
        summary: 'Year-to-date SBS income, income by month, counterparty and currency, deadlines',
        description:
          'Without `year`: the latest year with posted transactions, else the current year in ' +
          'Tbilisi. Counterparty and currency figures cover SBS income from the status start.',
        params: OrgParams,
        querystring: DashboardQuery,
        response: { 200: DashboardView, default: problemResponse },
      },
    },
    async (req) => {
      const today = tbilisiDate(opts.deps.now());
      const { orgId } = req.params;
      const y = await loadDeclarationYear(app.db, orgId, req.user.id, req.query.year, today);
      const yyyy = String(y.year).padStart(4, '0');
      const yearStart = `${yyyy}-01-01`;
      const range = y.sbsEffectiveFrom && {
        from: y.sbsEffectiveFrom > yearStart ? y.sbsEffectiveFrom : yearStart,
        to: `${yyyy}-12-31`,
      };
      const [byCounterparty, currencyMix] = range
        ? await Promise.all([
            sbsIncomeByCounterparty(app.db, orgId, range),
            sbsIncomeByCurrency(app.db, orgId, range),
          ])
        : [
            {
              top: [],
              rest: {
                counterparty: null,
                incomeGelMinor: 0n,
                transactionCount: 0,
                counterpartyCount: 0,
              },
            },
            [],
          ];

      const months = y.months;
      const latest = months.findLast((m) => m.incomeGelMinor !== 0n) ?? null;
      const next = months.find((m) => m.filingRequired && m.deadline >= today) ?? null;
      const attention = nextReturn(months, today);
      const statusCounts = Object.fromEntries(FILING_STATUS_KINDS.map((k) => [k, 0])) as Record<
        FilingStatusKind,
        number
      >;
      for (const m of months) statusCounts[m.status.kind] += 1;

      return {
        year: y.year,
        latestYearWithData: y.latestYearWithData,
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
        byCounterparty: {
          top: byCounterparty.top,
          other: {
            incomeGelMinor: byCounterparty.rest.incomeGelMinor,
            transactionCount: byCounterparty.rest.transactionCount,
            counterpartyCount: byCounterparty.rest.counterpartyCount,
          },
        },
        currencyMix,
        nextReturn: attention && {
          period: attention.period,
          deadline: attention.deadline,
          taxGelMinor: attention.taxGelMinor,
          zeroReturn: attention.zeroReturn,
          status: attention.status,
        },
        statusCounts,
        today,
      };
    },
  );
};
