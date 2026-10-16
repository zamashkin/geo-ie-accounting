// Monthly declarations: the year view, one period laid out like the rs.ge return, and filing.
// Live figures are computed from postings on every request; filing stores an immutable
// snapshot (declaration_filings), and a refiling stores a correction linked to the previous one.
import {
  DeclarationFigures,
  DeclarationFiling,
  DeclarationPeriodParams,
  DeclarationPeriodView,
  DeclarationYearView,
  FileDeclarationRequest,
  MutationHeaders,
  OrgParams,
  YearQuery,
} from '@ie-ledger/contracts';
import {
  insertFiling,
  listContributingTransactions,
  listFilings,
  lockFilingPeriod,
  type DbOrTx,
} from '@ie-ledger/db';
import {
  diffTransactionIds,
  filingBlocker,
  firstDayOf,
  parsePeriod,
  ruleSetFor,
} from '@ie-ledger/domain';
import { tbilisiDate } from '@ie-ledger/nbg';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import type { LedgerDeps } from '../ledger-deps';
import { loadDeclarationYear, toFilingDto } from './year';

/** One period: its month from the year computation, contributing transactions and filings. */
async function loadPeriod(
  db: DbOrTx,
  orgId: string,
  userId: string,
  period: string,
  today: string,
) {
  const { year: y } = parsePeriod(period);
  // Sequential: `db` may be the request transaction (one connection).
  const year = await loadDeclarationYear(db, orgId, userId, y, today);
  const transactions = await listContributingTransactions(db, orgId, period);
  const filings = await listFilings(db, orgId, period);
  const index = Number(period.slice(5, 7)) - 1;
  const figures = year.figures.months[index];
  const month = year.months[index];
  if (!figures || !month) throw new Error(`period ${period} missing from its year`);
  const sbsFrom = year.sbsEffectiveFrom;
  const rows = transactions.map((t) => ({
    ...t,
    excluded: sbsFrom === null || t.occurredOn < sbsFrom,
  }));
  /** The transactions behind the declared figures (excluded ones are not declared). */
  const declaredIds = rows.filter((t) => !t.excluded).map((t) => t.id);
  return { year, figures, month, rows, declaredIds, filings, sbsFrom };
}

export const declarationRoutes: FastifyPluginAsyncZod<{ deps: LedgerDeps }> = async (app, opts) => {
  const today = () => tbilisiDate(opts.deps.now());

  app.get(
    '/v1/orgs/:orgId/declarations',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getDeclarationYear',
        tags: ['declarations'],
        summary: 'Monthly SBS declaration figures for a year, with filing status and drift',
        description:
          'Per month: line 15 (`ytdGelMinor`), lines 18–21 (`byPaymentMethod`), rate, tax and ' +
          'deadline, computed from posted transactions on every request, plus `status` against ' +
          'the latest filing (drift lists the lines that moved). Without `year`: the latest ' +
          'year with posted transactions, else the current year.',
        params: OrgParams,
        querystring: YearQuery,
        response: { 200: DeclarationYearView, default: problemResponse },
      },
    },
    async (req) => {
      const t = today();
      const y = await loadDeclarationYear(app.db, req.params.orgId, req.user.id, req.query.year, t);
      return {
        ...y.figures,
        months: y.months,
        limitStatus: y.limitStatus,
        sbsEffectiveFrom: y.sbsEffectiveFrom,
        annualLimitGelMinor: y.annualLimitGelMinor,
        annualLimitUsedBp: y.annualLimitUsedBp,
        previousYearLimitExceeded: y.previousYearLimitExceeded,
        latestYearWithData: y.latestYearWithData,
        today: t,
      };
    },
  );

  app.get(
    '/v1/orgs/:orgId/declarations/:period',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'getDeclarationPeriod',
        tags: ['declarations'],
        summary: 'One monthly return laid out like rs.ge, with its transactions and filings',
        params: DeclarationPeriodParams,
        response: { 200: DeclarationPeriodView, default: problemResponse },
      },
    },
    async (req) => {
      const t = today();
      const { orgId, period } = req.params;
      const p = await loadPeriod(app.db, orgId, req.user.id, period, t);
      const rules = ruleSetFor(firstDayOf(period));
      const latest = p.filings[0];
      return {
        month: p.month,
        sbsEffectiveFrom: p.sbsFrom,
        rules: {
          version: rules.version,
          baseRateBp: rules.baseRateBp.value,
          increasedRateBp: rules.increasedRateBp.value,
          annualLimitGelMinor: rules.annualLimitGelMinor.value,
          filingDeadlineDayOfNextMonth: rules.filingDeadlineDayOfNextMonth.value,
        },
        transactions: p.rows,
        filings: p.filings.map(toFilingDto),
        transactionChanges: latest
          ? diffTransactionIds(latest.transactionIds, p.declaredIds)
          : null,
        fileBlocker: filingBlocker(p.figures, t),
        today: t,
      };
    },
  );

  app.post(
    '/v1/orgs/:orgId/declarations/:period/file',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'fileDeclaration',
        tags: ['declarations'],
        summary: 'Record that the return was filed on rs.ge: stores an immutable snapshot',
        description:
          'Snapshots the live figures, rules version and contributing transactions of the ' +
          'month. Nothing is sent to rs.ge. If the month is already filed, this files a ' +
          'correction: send the latest filing id as `supersedesId` (409 otherwise). Snapshots ' +
          'are never changed or deleted. 409 also when the month is not over yet or needs no ' +
          'return.',
        headers: MutationHeaders,
        params: DeclarationPeriodParams,
        body: FileDeclarationRequest,
        response: { 201: DeclarationFiling, default: problemResponse },
      },
    },
    async (req, reply) => {
      const t = today();
      const { orgId, period } = req.params;
      await lockFilingPeriod(req.tx, orgId, period);
      const p = await loadPeriod(req.tx, orgId, req.user.id, period, t);

      const blocker = filingBlocker(p.figures, t);
      if (blocker === 'period_open') {
        throw new HttpProblem(409, 'conflict', 'The month is not over yet; file it from the 1st.');
      }
      if (blocker === 'not_required') {
        throw new HttpProblem(
          409,
          'conflict',
          'No return is due for this month: the small-business status does not cover it.',
        );
      }

      const latest = p.filings[0] ?? null;
      const supersedesId = req.body.supersedesId ?? null;
      if (latest && supersedesId !== latest.id) {
        throw new HttpProblem(
          409,
          'conflict',
          `This month is already filed (version ${latest.version}). To file a correction, send ` +
            'its id as supersedesId.',
        );
      }
      if (!latest && supersedesId !== null) {
        throw new HttpProblem(409, 'conflict', 'There is no earlier filing to correct.');
      }

      const f = p.figures;
      const created = await insertFiling(req.tx, orgId, {
        period,
        version: latest ? latest.version + 1 : 1,
        supersedesId,
        rulesVersion: f.rulesVersion,
        incomeGelMinor: f.incomeGelMinor,
        ytdGelMinor: f.ytdGelMinor,
        byPaymentMethod: {
          cash_register: f.byPaymentMethod.cash_register.toString(),
          pos: f.byPaymentMethod.pos.toString(),
          bank: f.byPaymentMethod.bank.toString(),
          other: f.byPaymentMethod.other.toString(),
        },
        rateBp: f.rateBp,
        taxGelMinor: f.taxGelMinor,
        zeroReturn: f.zeroReturn,
        transactionIds: p.declaredIds,
        snapshot: {
          figures: z.encode(DeclarationFigures, f),
          sbsEffectiveFrom: p.sbsFrom,
          filedOn: t,
        },
        rsReference: req.body.rsReference || null,
        filedBy: req.user.id,
      });
      const dto = toFilingDto(created);
      await req.audit(
        'declaration_filing',
        created.id,
        null,
        {
          period,
          version: created.version,
          supersedesId,
          rulesVersion: created.rulesVersion,
          figures: dto.figures,
          transactionCount: created.transactionIds.length,
          rsReference: created.rsReference,
        },
        { action: latest ? 'file_correction' : 'file' },
      );
      reply.code(201);
      return dto;
    },
  );
};
