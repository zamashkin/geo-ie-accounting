import { z } from 'zod';
import { DeclarationFigures } from './domain';
import { IncomeByPaymentMethod } from './entities';
import { PaymentMethod, TransactionSource } from './enums';
import { DashboardResponse, DeclarationYearResponse } from './ledger';
import { CurrencyCode, IsoDate, MinorUnits, Period, Timestamp, Uuid } from './primitives';
import { OrgParams } from './tenancy';

// Declaration filing, status, drift and the richer dashboard (WS-08 on the MVP's
// compute-on-request model). Live figures are always computed from postings; filing stores an
// immutable snapshot of them. Corrections are new snapshots linked to the previous one.

export const DeclarationPeriodParams = OrgParams.extend({ period: Period });
export type DeclarationPeriodParams = z.output<typeof DeclarationPeriodParams>;

// ── Status and drift ────────────────────────────────────────────────────────────────────

/** Mirrors domain `FILING_STATUS_KINDS`. */
export const FILING_STATUS_KINDS = [
  'not_due',
  'due',
  'overdue',
  'filed',
  'filed_with_drift',
] as const;
export const FilingStatusKind = z.enum(FILING_STATUS_KINDS).meta({
  id: 'FilingStatusKind',
  description:
    '`not_due`: no return for the month, or the month is not over. `due`: the month is over ' +
    'and the deadline is today or later. `overdue`: past the deadline, never filed. `filed`: ' +
    'the latest filing matches the live figures. `filed_with_drift`: they differ.',
});
export type FilingStatusKind = z.output<typeof FilingStatusKind>;

export const NOT_DUE_REASONS = ['not_required', 'period_open'] as const;
export const NotDueReason = z.enum(NOT_DUE_REASONS).meta({ id: 'NotDueReason' });
export type NotDueReason = z.output<typeof NotDueReason>;

/** Mirrors domain `RETURN_LINES`. */
export const RETURN_LINES = [
  'income',
  'line15',
  'line18',
  'line19',
  'line20',
  'line21',
  'rate',
  'tax',
] as const;
export const ReturnLine = z.enum(RETURN_LINES).meta({ id: 'ReturnLine' });
export type ReturnLine = z.output<typeof ReturnLine>;

/** One return line whose live value differs from the latest filing. */
export const LineDifference = z
  .object({
    line: ReturnLine,
    /** GEL minor units; basis points for `rate`. */
    filed: MinorUnits,
    live: MinorUnits,
    /** live − filed. */
    delta: MinorUnits,
  })
  .meta({ id: 'LineDifference' });
export type LineDifference = z.output<typeof LineDifference>;

export const FilingStatus = z
  .object({
    kind: FilingStatusKind,
    /** `not_due` only. */
    reason: NotDueReason.nullable(),
    /** `due` only: days from today (Tbilisi) to the deadline, 0 on the day itself. */
    daysLeft: z.int().nonnegative().nullable(),
    /** `overdue` only. */
    daysOverdue: z.int().positive().nullable(),
    /** `filed_with_drift` only; empty otherwise. */
    differences: z.array(LineDifference),
  })
  .meta({ id: 'FilingStatus' });
export type FilingStatus = z.output<typeof FilingStatus>;

// ── Filings ─────────────────────────────────────────────────────────────────────────────

/** The figures a filing stored: what was typed into rs.ge. */
export const FiledFigures = z
  .object({
    incomeGelMinor: MinorUnits,
    /** Line 15. */
    ytdGelMinor: MinorUnits,
    /** Lines 18–21. */
    byPaymentMethod: IncomeByPaymentMethod,
    rateBp: z.int().nonnegative(),
    taxGelMinor: MinorUnits,
  })
  .meta({ id: 'FiledFigures' });
export type FiledFigures = z.output<typeof FiledFigures>;

/** An immutable snapshot of a month's return, as filed. Never changed or deleted. */
export const DeclarationFiling = z
  .object({
    id: Uuid,
    period: Period,
    /** 1 for the original return, 2+ for corrections. */
    version: z.int().positive(),
    /** The filing this one corrects; null for the original. */
    supersedesId: Uuid.nullable(),
    rulesVersion: z.string(),
    figures: FiledFigures,
    zeroReturn: z.boolean(),
    /** The transactions behind the figures at filing time. */
    transactionIds: z.array(Uuid),
    /** The rs.ge reference number the user entered, if any. */
    rsReference: z.string().nullable(),
    filedAt: Timestamp,
    filedBy: z.object({ id: Uuid, name: z.string(), email: z.string() }),
  })
  .meta({ id: 'DeclarationFiling' });
export type DeclarationFiling = z.output<typeof DeclarationFiling>;

/** The latest filing of a month, in short. */
export const FilingSummary = DeclarationFiling.pick({
  id: true,
  version: true,
  filedAt: true,
  rsReference: true,
}).meta({ id: 'FilingSummary' });
export type FilingSummary = z.output<typeof FilingSummary>;

/**
 * `POST /declarations/:period/file`. To file a correction, send the id of the latest filing as
 * `supersedesId`: a stale or missing one is a 409, so two people cannot both "correct" the same
 * return without seeing each other's.
 */
export const FileDeclarationRequest = z
  .object({
    rsReference: z.string().trim().max(64).nullable().optional(),
    supersedesId: Uuid.nullable().optional(),
  })
  .meta({ id: 'FileDeclarationRequest' });
export type FileDeclarationRequest = z.output<typeof FileDeclarationRequest>;

// ── Year and period views ───────────────────────────────────────────────────────────────

export const DeclarationMonthView = DeclarationFigures.extend({
  status: FilingStatus,
  latestFiling: FilingSummary.nullable(),
}).meta({ id: 'DeclarationMonthView' });
export type DeclarationMonthView = z.output<typeof DeclarationMonthView>;

/** `GET /declarations?year=`: live figures per month with filing status and drift. */
export const DeclarationYearView = DeclarationYearResponse.extend({
  months: z.array(DeclarationMonthView).length(12),
  /** Today in Tbilisi: what `status` is relative to. */
  today: IsoDate,
}).meta({ id: 'DeclarationYearView' });
export type DeclarationYearView = z.output<typeof DeclarationYearView>;

/** A transaction behind a month's SBS income. */
export const ContributingTransaction = z
  .object({
    id: Uuid,
    occurredOn: IsoDate,
    description: z.string(),
    source: TransactionSource,
    paymentMethod: PaymentMethod.nullable(),
    reversesId: Uuid.nullable(),
    /** SBS income the transaction adds to the month (negative for a reversal). */
    incomeGelMinor: MinorUnits,
    /** The same income in its original currency. */
    amountMinor: MinorUnits,
    currency: CurrencyCode,
    counterparty: z.string().nullable(),
    /** Dated before the status start: excluded from the return. */
    excluded: z.boolean(),
  })
  .meta({ id: 'ContributingTransaction' });
export type ContributingTransaction = z.output<typeof ContributingTransaction>;

/** The tax rule values the period was computed with (from packages/domain). */
export const PeriodRules = z
  .object({
    version: z.string(),
    baseRateBp: z.int(),
    increasedRateBp: z.int(),
    annualLimitGelMinor: MinorUnits,
    filingDeadlineDayOfNextMonth: z.int(),
  })
  .meta({ id: 'PeriodRules' });
export type PeriodRules = z.output<typeof PeriodRules>;

/** `GET /declarations/:period`: one return, laid out like the rs.ge lines. */
export const DeclarationPeriodView = z
  .object({
    month: DeclarationMonthView,
    sbsEffectiveFrom: IsoDate.nullable(),
    rules: PeriodRules,
    /** Oldest first. */
    transactions: z.array(ContributingTransaction),
    /** Newest first. */
    filings: z.array(DeclarationFiling),
    /** Transactions that joined or left the month since the latest filing; null if never filed. */
    transactionChanges: z.object({ added: z.array(Uuid), removed: z.array(Uuid) }).nullable(),
    /** Why the month cannot be filed today; null when it can. */
    fileBlocker: NotDueReason.nullable(),
    today: IsoDate,
  })
  .meta({ id: 'DeclarationPeriodView' });
export type DeclarationPeriodView = z.output<typeof DeclarationPeriodView>;

// ── Dashboard ───────────────────────────────────────────────────────────────────────────

export const CounterpartyIncome = z
  .object({
    /** null: no counterparty known (e.g. a manual transaction). */
    counterparty: z.string().nullable(),
    incomeGelMinor: MinorUnits,
    transactionCount: z.int().nonnegative(),
  })
  .meta({ id: 'CounterpartyIncome' });
export type CounterpartyIncome = z.output<typeof CounterpartyIncome>;

export const CurrencyIncome = z
  .object({
    currency: CurrencyCode,
    /** In the original currency. */
    amountMinor: MinorUnits,
    incomeGelMinor: MinorUnits,
    transactionCount: z.int().nonnegative(),
  })
  .meta({ id: 'CurrencyIncome' });
export type CurrencyIncome = z.output<typeof CurrencyIncome>;

/** `GET /dashboard?year=`: the MVP summary plus counterparties, currencies and filing status. */
export const DashboardView = DashboardResponse.extend({
  /** Top 5 counterparties by SBS income of the year, then the rest summed. */
  byCounterparty: z.object({
    top: z.array(CounterpartyIncome).max(5),
    other: CounterpartyIncome.omit({ counterparty: true }).extend({
      counterpartyCount: z.int().nonnegative(),
    }),
  }),
  /** SBS income by original currency, largest GEL equivalent first. */
  currencyMix: z.array(CurrencyIncome),
  /**
   * The month that needs attention first: the earliest overdue, due or drifted month of the
   * year, else the next one whose deadline is still ahead. null when none.
   */
  nextReturn: z
    .object({
      period: Period,
      deadline: IsoDate,
      taxGelMinor: MinorUnits,
      zeroReturn: z.boolean(),
      status: FilingStatus,
    })
    .nullable(),
  /** How many months of the year are in each status. */
  statusCounts: z.record(FilingStatusKind, z.int().nonnegative()),
  today: IsoDate,
}).meta({ id: 'DashboardView' });
export type DashboardView = z.output<typeof DashboardView>;
