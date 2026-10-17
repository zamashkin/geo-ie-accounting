'use client';

import {
  Badge,
  Button,
  ButtonLink,
  Dialog,
  DialogFooter,
  Sheet,
  SkeletonText,
  toast,
} from '@ie-ledger/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Link2, Undo2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { Amount } from '@/components/Amount';
import { Notice } from '@/components/Notice';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import {
  ledgerKeys,
  reverseTransaction,
  transactionQuery,
  type TransactionView,
} from '@/lib/api/ledger';
import { invoiceKeys, matchPayment, transactionInvoiceHintsQuery } from '@/lib/api/invoices';
import { formatIsoDate, formatMinor, parseMinor } from '@/lib/format';
import { PAYMENT_METHOD_LABELS, TRANSACTION_SOURCE_LABELS } from '@/lib/labels';
import { orgHref } from '@/lib/nav';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Postings({ tx }: { tx: TransactionView }) {
  return (
    <section aria-labelledby="postings-heading" className="flex flex-col gap-2">
      <h3 id="postings-heading" className="text-sm font-semibold">
        Postings
      </h3>
      <ul className="flex flex-col gap-2">
        {tx.postings.map((p) => (
          <li key={p.id} className="rounded-md border border-line p-3">
            <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
              {p.account.name}
              {p.account.incomeClass === 'sbs' ? <Badge tone="accent">SBS income</Badge> : null}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Detail label="Original amount">
                <Amount minor={p.amountMinor} currency={p.currency} />
              </Detail>
              <Detail label="GEL equivalent">
                <Amount minor={p.gelAmountMinor} currency="GEL" />
              </Detail>
              {p.rate ? (
                <>
                  <Detail label="NBG rate">
                    <span className="tabular-nums">
                      {p.rate.rate} GEL per {p.rate.quantity} {p.currency}
                    </span>
                  </Detail>
                  <Detail label="Rate date">
                    <time dateTime={p.rate.validFrom}>{formatIsoDate(p.rate.validFrom)}</time>
                  </Detail>
                </>
              ) : null}
            </dl>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-muted">
        Positive amounts are debits, negative are credits. Every transaction balances in each
        currency.
      </p>
    </section>
  );
}

/** Invoices an incoming imported payment pays, and open invoices it could pay. */
function InvoiceHints({
  orgId,
  tx,
  canWrite,
}: {
  orgId: string;
  tx: TransactionView;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const q = useQuery(transactionInvoiceHintsQuery(orgId, tx.id));
  const match = useMutation({
    mutationFn: (invoiceId: string) =>
      matchPayment(orgId, invoiceId, { transactionId: tx.id }, newIdempotencyKey()),
    onSuccess: async (invoice) => {
      toast({
        title:
          invoice.status === 'paid' ? `${invoice.number ?? 'Invoice'} paid` : 'Payment matched',
        tone: 'positive',
      });
      await queryClient.invalidateQueries({ queryKey: invoiceKeys.invoices(orgId) });
    },
    onError: (err) => {
      toast({ title: 'Could not match', description: errorMessage(err), tone: 'negative' });
    },
  });
  const data = q.data;
  if (!data || (data.allocations.length === 0 && data.suggestions.length === 0)) return null;
  const invoiceLink = (id: string) => orgHref(orgId, `/invoices/${id}`) as Route;
  return (
    <section aria-labelledby="invoice-hints-heading" className="flex flex-col gap-2">
      <h3 id="invoice-hints-heading" className="text-sm font-semibold">
        Invoices
      </h3>
      <ul className="flex flex-col gap-2">
        {data.allocations.map((a) => (
          <li
            key={a.invoiceId}
            className="flex items-center gap-2 rounded-md border border-line p-3 text-sm"
          >
            <FileText aria-hidden className="size-4 text-fg-muted" />
            <span className="min-w-0 flex-1">
              Pays{' '}
              <Link
                href={invoiceLink(a.invoiceId)}
                className="font-medium underline underline-offset-4"
              >
                {a.number ?? 'an invoice'}
              </Link>{' '}
              ({a.clientName}): {formatMinor(a.amountMinor, a.currency)}
            </span>
          </li>
        ))}
        {data.suggestions.map((h) => (
          <li
            key={h.invoiceId}
            className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-line p-3 text-sm"
          >
            <span className="min-w-0 flex-1">
              <Badge tone="info">Possible invoice</Badge>{' '}
              <Link
                href={invoiceLink(h.invoiceId)}
                className="font-medium underline underline-offset-4"
              >
                {h.number}
              </Link>{' '}
              · {h.clientName} · {formatMinor(h.outstandingMinor, h.currency)} owed
            </span>
            {canWrite ? (
              <Button
                size="sm"
                variant="secondary"
                isPending={match.isPending && match.variables === h.invoiceId}
                isDisabled={match.isPending}
                onPress={() => {
                  match.mutate(h.invoiceId, { onSuccess: () => void q.refetch() });
                }}
              >
                <Link2 aria-hidden />
                Match {formatMinor(h.allocateMinor, h.currency)}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReverseButton({
  orgId,
  tx,
  onReversed,
}: {
  orgId: string;
  tx: TransactionView;
  onReversed: (reversal: TransactionView) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const reverse = useMutation({
    mutationFn: (key: string) => reverseTransaction(orgId, tx.id, key),
    onSuccess: (reversal) => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ledgerKeys.transactions(orgId) });
      toast({
        title: 'Transaction reversed',
        description: 'A reversing transaction on the same date takes it back out.',
        tone: 'positive',
      });
      onReversed(reversal);
    },
  });
  const leg = tx.postings[0];

  return (
    <>
      <Button
        variant="secondary"
        onPress={() => {
          reverse.reset();
          setOpen(true);
        }}
      >
        <Undo2 aria-hidden />
        Reverse
      </Button>
      <Dialog
        role="alertdialog"
        title="Reverse this transaction?"
        description="Posted transactions never change. A reversing transaction with every posting negated is booked on the same date, so any income it declared comes back out of that month."
        isOpen={open}
        onOpenChange={setOpen}
        size="sm"
      >
        {leg ? (
          <p className="text-sm">
            {formatIsoDate(tx.occurredOn)}: {formatMinor(leg.amountMinor, leg.currency)} (
            {formatMinor(leg.gelAmountMinor, 'GEL')})
          </p>
        ) : null}
        {reverse.isError ? <Notice tone="error">{errorMessage(reverse.error)}</Notice> : null}
        <DialogFooter>
          <Button
            variant="secondary"
            isDisabled={reverse.isPending}
            onPress={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={reverse.isPending}
            onPress={() => {
              reverse.mutate(newIdempotencyKey());
            }}
          >
            Reverse transaction
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

/** Transaction detail: postings, original amount, GEL equivalent, NBG rate and rate date. */
export function TransactionSheet({
  orgId,
  transactionId,
  initial,
  canWrite,
  onOpen,
  onClose,
}: {
  orgId: string;
  transactionId: string | null;
  initial: TransactionView | undefined;
  canWrite: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const q = useQuery({
    ...transactionQuery(orgId, transactionId ?? ''),
    enabled: transactionId !== null,
    ...(initial ? { initialData: initial } : {}),
  });
  const tx = q.data;
  const leg = tx?.postings[0];

  return (
    <Sheet
      title={leg ? formatMinor(leg.amountMinor, leg.currency) : 'Transaction'}
      description={tx ? formatIsoDate(tx.occurredOn) : undefined}
      isOpen={transactionId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="sm:w-[30rem]"
    >
      {q.isError ? (
        <Notice tone="error">{errorMessage(q.error)}</Notice>
      ) : !tx ? (
        <SkeletonText lines={6} />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm break-words">{tx.description}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Detail label="Source">
              <span className="flex flex-wrap gap-1">
                <Badge tone={tx.source === 'reversal' ? 'warning' : 'neutral'}>
                  {TRANSACTION_SOURCE_LABELS[tx.source]}
                </Badge>
                {tx.reversedById ? <Badge tone="negative">Reversed</Badge> : null}
              </span>
            </Detail>
            <Detail label="Payment method">
              {tx.paymentMethod ? PAYMENT_METHOD_LABELS[tx.paymentMethod] : '—'}
            </Detail>
          </dl>
          {tx.reversesId || tx.reversedById ? (
            <Notice tone="info">
              {tx.reversesId ? 'This transaction reverses another one. ' : null}
              {tx.reversedById ? 'This transaction has been reversed. ' : null}
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  onOpen((tx.reversesId ?? tx.reversedById) as string);
                }}
              >
                {tx.reversesId ? 'Open the original' : 'Open the reversal'}
              </Button>
            </Notice>
          ) : null}
          {tx.source === 'import' && leg && parseMinor(leg.amountMinor) > 0n ? (
            <InvoiceHints orgId={orgId} tx={tx} canWrite={canWrite} />
          ) : null}
          <Postings tx={tx} />
          <div className="flex flex-wrap gap-2">
            {canWrite && !tx.reversedById && tx.source !== 'reversal' ? (
              <ReverseButton
                orgId={orgId}
                tx={tx}
                onReversed={() => {
                  void q.refetch();
                }}
              />
            ) : null}
            {tx.importBatchId ? (
              <ButtonLink variant="ghost" href={orgHref(orgId, `/imports/${tx.importBatchId}`)}>
                Open the import
              </ButtonLink>
            ) : null}
          </div>
        </div>
      )}
    </Sheet>
  );
}
