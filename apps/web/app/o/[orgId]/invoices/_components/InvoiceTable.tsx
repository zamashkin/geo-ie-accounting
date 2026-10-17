import type { Route } from 'next';
import Link from 'next/link';
import { Amount } from '@/components/Amount';
import type { Schemas } from '@/lib/api/client';
import { formatIsoDate } from '@/lib/format';
import { orgHref } from '@/lib/nav';
import { InvoiceStatusBadge } from '../../_components/InvoiceStatusBadge';

type Invoice = Schemas['InvoiceSummary'];

const th = 'px-3 py-2 text-start text-xs font-medium text-fg-muted';
const td = 'px-3 py-2.5 align-top';

/** Invoices as a table on wide screens and a list of cards on phones. Server-rendered. */
export function InvoiceTable({
  orgId,
  invoices,
  showClient = true,
  caption,
}: {
  orgId: string;
  invoices: readonly Invoice[];
  showClient?: boolean;
  caption: string;
}) {
  const href = (i: Invoice) => orgHref(orgId, `/invoices/${i.id}`) as Route;
  const label = (i: Invoice) => i.number ?? 'Draft';
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className={th}>
                Number
              </th>
              {showClient ? (
                <th scope="col" className={th}>
                  Client
                </th>
              ) : null}
              <th scope="col" className={th}>
                Issued
              </th>
              <th scope="col" className={th}>
                Due
              </th>
              <th scope="col" className={th}>
                Status
              </th>
              <th scope="col" className={`${th} text-end`}>
                Total
              </th>
              <th scope="col" className={`${th} text-end`}>
                Outstanding
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0 hover:bg-surface-muted">
                <th scope="row" className={`${td} text-start font-medium`}>
                  <Link href={href(i)} className="underline-offset-4 hover:underline">
                    {label(i)}
                  </Link>
                </th>
                {showClient ? <td className={td}>{i.clientName}</td> : null}
                <td className={`${td} whitespace-nowrap`}>
                  {i.issueDate ? formatIsoDate(i.issueDate) : '—'}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {i.dueDate ? formatIsoDate(i.dueDate) : '—'}
                </td>
                <td className={td}>
                  <InvoiceStatusBadge status={i.status} overdue={i.overdue} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount minor={i.totalMinor} currency={i.currency} />
                </td>
                <td className={`${td} text-end`}>
                  {i.status === 'issued' ? (
                    <Amount minor={i.outstandingMinor} currency={i.currency} />
                  ) : (
                    <span className="text-fg-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden" aria-label={caption}>
        {invoices.map((i) => (
          <li key={i.id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <Link href={href(i)} className="font-medium underline-offset-4 hover:underline">
                {label(i)}
              </Link>
              <InvoiceStatusBadge status={i.status} overdue={i.overdue} />
            </div>
            {showClient ? <p className="mt-1 text-sm">{i.clientName}</p> : null}
            <div className="mt-1 flex items-end justify-between gap-2 text-xs text-fg-muted">
              <span>{i.dueDate ? `Due ${formatIsoDate(i.dueDate)}` : 'No due date'}</span>
              <Amount minor={i.totalMinor} currency={i.currency} className="text-sm text-fg" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
