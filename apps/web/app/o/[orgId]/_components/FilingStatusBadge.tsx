import { Badge, type BadgeTone } from '@ie-ledger/ui';
import type { Schemas } from '@/lib/api/client';

export type FilingStatus = Schemas['FilingStatus'];

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/** Short status text for a month: what to do next. Zero months say "file zero return". */
export function filingStatusLabel(status: FilingStatus, zeroReturn: boolean): string {
  const file = zeroReturn ? 'File zero return' : 'Due';
  switch (status.kind) {
    case 'not_due':
      return status.reason === 'period_open' ? 'Month in progress' : 'Not required';
    case 'due':
      return status.daysLeft === 0
        ? `${file} today`
        : `${file}, ${days(status.daysLeft ?? 0)} left`;
    case 'overdue':
      return `${zeroReturn ? 'Zero return overdue' : 'Overdue'}, ${days(status.daysOverdue ?? 0)}`;
    case 'filed':
      return 'Filed';
    case 'filed_with_drift':
      return 'Filed, figures changed';
  }
}

const TONE: Record<FilingStatus['kind'], BadgeTone> = {
  not_due: 'neutral',
  due: 'warning',
  overdue: 'negative',
  filed: 'positive',
  filed_with_drift: 'warning',
};

export function FilingStatusBadge({
  status,
  zeroReturn,
}: {
  status: FilingStatus;
  zeroReturn: boolean;
}) {
  return (
    <Badge tone={TONE[status.kind]} dot data-status={status.kind}>
      {filingStatusLabel(status, zeroReturn)}
    </Badge>
  );
}

/** Return line labels, in return order (SPEC §2.4). */
export const RETURN_LINE_LABELS: Record<Schemas['ReturnLine'], string> = {
  income: 'Income of the month',
  line15: 'Line 15, cumulative income',
  line18: 'Line 18, cash register',
  line19: 'Line 19, POS terminal',
  line20: 'Line 20, bank account',
  line21: 'Line 21, other',
  rate: 'Rate',
  tax: 'Tax',
};
