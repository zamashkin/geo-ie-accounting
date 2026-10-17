import { Badge, type BadgeTone } from '@geo-ie-accounting/ui';
import type { Schemas } from '@/lib/api/client';

type Status = Schemas['InvoiceSummary']['status'];

export const INVOICE_STATUS: Record<Status, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  issued: { label: 'Issued', tone: 'info' },
  paid: { label: 'Paid', tone: 'positive' },
  void: { label: 'Void', tone: 'warning' },
};

/** Status, with "Overdue" in place of "Issued" once the due date has passed. */
export function InvoiceStatusBadge({ status, overdue }: { status: Status; overdue: boolean }) {
  if (overdue) {
    return (
      <Badge tone="negative" dot data-status="overdue">
        Overdue
      </Badge>
    );
  }
  const s = INVOICE_STATUS[status];
  return (
    <Badge tone={s.tone} dot data-status={status}>
      {s.label}
    </Badge>
  );
}
