// Live declaration figures with filing status, shared by the declarations and dashboard routes.
// Figures are computed from postings on every request (docs/MVP.md); filings are immutable
// snapshots compared against them for drift.
import type {
  DeclarationFiling,
  FiledFigures as FiledFiguresDto,
  FilingStatus as FilingStatusDto,
  FilingSummary,
} from '@geo-ie-accounting/contracts';
import {
  getOrganizationForUser,
  latestFilingsForYear,
  latestTransactionYear,
  listSbsIncomeEntries,
  type DbOrTx,
  type DeclarationFilingRow,
  type DeclarationFilingWithFiler,
} from '@geo-ie-accounting/db';
import {
  annualLimitStatus,
  annualLimitUsageBp,
  computeDeclarationYear,
  filingStatus,
  ruleSetFor,
  TAX_RULE_SETS,
  type FiledFigures,
  type FilingStatus,
  type MonthDeclaration,
} from '@geo-ie-accounting/domain';
import { HttpProblem } from '../../problem';

export function filedFiguresOf(row: DeclarationFilingRow): FiledFigures {
  const m = row.byPaymentMethod;
  return {
    incomeGelMinor: row.incomeGelMinor,
    ytdGelMinor: row.ytdGelMinor,
    byPaymentMethod: {
      cash_register: BigInt(m.cash_register),
      pos: BigInt(m.pos),
      bank: BigInt(m.bank),
      other: BigInt(m.other),
    },
    rateBp: row.rateBp,
    taxGelMinor: row.taxGelMinor,
  };
}

export function toStatusDto(s: FilingStatus): FilingStatusDto {
  return {
    kind: s.kind,
    reason: s.kind === 'not_due' ? s.reason : null,
    daysLeft: s.kind === 'due' ? s.daysLeft : null,
    daysOverdue: s.kind === 'overdue' ? s.daysOverdue : null,
    differences: s.kind === 'filed_with_drift' ? [...s.differences] : [],
  };
}

export function toFilingSummary(row: DeclarationFilingRow): FilingSummary {
  return {
    id: row.id,
    version: row.version,
    filedAt: row.filedAt.toISOString(),
    rsReference: row.rsReference,
  };
}

export function toFilingDto(row: DeclarationFilingWithFiler): DeclarationFiling {
  const figures: FiledFiguresDto = filedFiguresOf(row);
  return {
    id: row.id,
    period: row.period.trim(),
    version: row.version,
    supersedesId: row.supersedesId,
    rulesVersion: row.rulesVersion,
    figures,
    zeroReturn: row.zeroReturn,
    transactionIds: row.transactionIds,
    rsReference: row.rsReference,
    filedAt: row.filedAt.toISOString(),
    filedBy: row.filer,
  };
}

/** A month's live figures with its status against the latest filing. */
export function monthView(
  month: MonthDeclaration,
  latest: DeclarationFilingRow | null,
  today: string,
) {
  const status = filingStatus(month, latest ? filedFiguresOf(latest) : null, today);
  return {
    ...month,
    status: toStatusDto(status),
    latestFiling: latest ? toFilingSummary(latest) : null,
  };
}

export type MonthView = ReturnType<typeof monthView>;

/** Every month of `year` has a tax rule set (rule sets start in January 2024). */
function hasRules(year: number): boolean {
  return TAX_RULE_SETS.some((r) => r.effectiveFrom <= `${String(year).padStart(4, '0')}-01-01`);
}

/**
 * The year's figures with filing status per month, plus the limit status (which needs the
 * previous year). Without `requested`, the year is the latest one with posted transactions,
 * else `today`'s. Four queries whatever the data: org, latest year, two years of aggregated
 * SBS income, and the latest filing per month.
 */
export async function loadDeclarationYear(
  db: DbOrTx,
  orgId: string,
  userId: string,
  requested: number | undefined,
  today: string,
) {
  const org = await getOrganizationForUser(db, orgId, userId);
  if (!org) throw new HttpProblem(404, 'not_found', 'Organization not found.');
  const latestYearWithData = await latestTransactionYear(db, orgId);
  const year = requested ?? latestYearWithData ?? Number(today.slice(0, 4));
  const sbsEffectiveFrom = org.sbsEffectiveFrom;
  if (!hasRules(year)) {
    throw new HttpProblem(422, 'validation_failed', `No tax rules cover ${year}.`);
  }
  // Sequential: `db` may be the request transaction, one connection that runs one query at a time.
  const entries = await listSbsIncomeEntries(db, orgId, year);
  const previousEntries = await listSbsIncomeEntries(db, orgId, year - 1);
  const filings = await latestFilingsForYear(db, orgId, year);
  const figures = computeDeclarationYear({ year, entries, sbsEffectiveFrom });
  // The first year with rules has no computable previous year: it counts as within the limit.
  const previousLimitExceeded =
    hasRules(year - 1) &&
    computeDeclarationYear({ year: year - 1, entries: previousEntries, sbsEffectiveFrom })
      .limitExceeded;
  const rules = ruleSetFor(`${String(year).padStart(4, '0')}-12-01`);
  const months = figures.months.map((m) => monthView(m, filings.get(m.period) ?? null, today));
  return {
    year,
    latestYearWithData,
    figures,
    months,
    sbsEffectiveFrom,
    previousYearLimitExceeded: previousLimitExceeded,
    limitStatus: annualLimitStatus(figures.totalIncomeGelMinor, previousLimitExceeded, rules),
    annualLimitGelMinor: rules.annualLimitGelMinor.value,
    annualLimitUsedBp: annualLimitUsageBp(figures.totalIncomeGelMinor, rules),
  };
}
