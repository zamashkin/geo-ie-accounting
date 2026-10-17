'use client';

import {
  Badge,
  Button,
  Dialog,
  DialogFooter,
  EmptyState,
  MoneyInput,
  SkeletonText,
  TextField,
  toast,
} from '@geo-ie-accounting/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, Download, Link2, Unlink, Wallet } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Amount } from '@/components/Amount';
import { Notice } from '@/components/Notice';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import {
  duplicateInvoice,
  invoiceKeys,
  invoicePdfUrl,
  type InvoiceView,
  matchPayment,
  paymentSuggestionsQuery,
  type PaymentSuggestion,
  unmatchPayment,
  voidInvoice,
} from '@/lib/api/invoices';
import { formatIsoDate, formatMinor, parseMinor } from '@/lib/format';
import { orgHref } from '@/lib/nav';

const AMOUNT_MATCH_LABEL: Record<PaymentSuggestion['amountMatch'], string> = {
  exact: 'Exact amount',
  partial: 'Part payment',
  over: 'Larger payment',
};

function useRefresh(orgId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: invoiceKeys.invoices(orgId) });
    router.refresh();
  };
}

function MatchPaymentDialog({
  orgId,
  invoice,
  isOpen,
  onOpenChange,
}: {
  orgId: string;
  invoice: InvoiceView;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefresh(orgId);
  const q = useQuery({ ...paymentSuggestionsQuery(orgId, invoice.id), enabled: isOpen });
  const [amount, setAmount] = useState<string | null>(null);
  const match = useMutation({
    mutationFn: (s: PaymentSuggestion) =>
      matchPayment(
        orgId,
        invoice.id,
        { transactionId: s.transactionId, ...(amount ? { amountMinor: amount } : {}) },
        newIdempotencyKey(),
      ),
    onSuccess: async (updated) => {
      toast(
        updated.status === 'paid'
          ? { title: 'Invoice paid', tone: 'positive' }
          : {
              title: 'Payment matched',
              description: `${formatMinor(updated.outstandingMinor, updated.currency)} still outstanding.`,
              tone: 'positive',
            },
      );
      setAmount(null);
      onOpenChange(false);
      await refresh();
    },
  });

  return (
    <Dialog
      title="Match a payment"
      description={`Incoming bank lines in ${invoice.currency} from on or after the issue date that look like this client paying. Outstanding: ${formatMinor(invoice.outstandingMinor, invoice.currency)}.`}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {match.isError ? <Notice tone="error">{errorMessage(match.error)}</Notice> : null}
        <MoneyInput
          label="Amount to allocate"
          description="Optional. Empty: what is left of the payment, up to what is owed."
          currency={invoice.currency}
          value={amount}
          onChange={setAmount}
        />
        {q.isPending ? (
          <SkeletonText lines={3} />
        ) : q.isError ? (
          <Notice tone="error">{errorMessage(q.error)}</Notice>
        ) : q.data.length === 0 ? (
          <EmptyState
            icon={<Wallet />}
            title="No matching payments"
            description="Import the bank statement with the payment, then come back here."
          />
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Suggested payments">
            {q.data.map((s) => (
              <li
                key={s.transactionId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Amount minor={s.amountMinor} currency={s.currency} />
                    <span className="text-fg-muted">on {formatIsoDate(s.occurredOn)}</span>
                    <Badge tone={s.amountMatch === 'exact' ? 'positive' : 'info'}>
                      {AMOUNT_MATCH_LABEL[s.amountMatch]}
                    </Badge>
                  </span>
                  <span className="truncate text-xs text-fg-muted" title={s.description}>
                    {s.counterparty ?? 'No counterparty'} · {s.description}
                  </span>
                  {parseMinor(s.unallocatedMinor) !== parseMinor(s.amountMinor) ? (
                    <span className="text-xs text-fg-muted">
                      {formatMinor(s.unallocatedMinor, s.currency)} not yet allocated
                    </span>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  isPending={match.isPending && match.variables.transactionId === s.transactionId}
                  isDisabled={match.isPending}
                  onPress={() => {
                    match.mutate(s);
                  }}
                >
                  <Link2 aria-hidden />
                  Match {formatMinor(amount ?? s.allocateMinor, s.currency)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <DialogFooter>
        <Button
          variant="secondary"
          onPress={() => {
            onOpenChange(false);
          }}
        >
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function VoidDialog({
  orgId,
  invoice,
  isOpen,
  onOpenChange,
}: {
  orgId: string;
  invoice: InvoiceView;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefresh(orgId);
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => voidInvoice(orgId, invoice.id, reason.trim(), newIdempotencyKey()),
    onSuccess: async () => {
      toast({ title: `Voided ${invoice.number ?? ''}`, tone: 'positive' });
      onOpenChange(false);
      await refresh();
    },
  });
  return (
    <Dialog
      role="alertdialog"
      title={`Void invoice ${invoice.number ?? ''}?`}
      description="A void invoice keeps its number, so the sequence has no gap, and is no longer owed. This cannot be undone."
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="sm"
    >
      <div className="flex flex-col gap-3">
        {mutation.isError ? <Notice tone="error">{errorMessage(mutation.error)}</Notice> : null}
        <TextField
          label="Reason"
          description="Optional, kept in the audit log."
          value={reason}
          onChange={setReason}
        />
      </div>
      <DialogFooter>
        <Button
          variant="secondary"
          onPress={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          isPending={mutation.isPending}
          onPress={() => {
            mutation.mutate();
          }}
        >
          Void invoice
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Header actions of an issued, paid or void invoice. */
export function InvoiceActions({
  orgId,
  invoice,
  canWrite,
}: {
  orgId: string;
  invoice: InvoiceView;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [matching, setMatching] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const duplicate = useMutation({
    mutationFn: () => duplicateInvoice(orgId, invoice.id, newIdempotencyKey()),
    onSuccess: (copy) => {
      toast({ title: 'Copied into a new draft', tone: 'positive' });
      router.push(orgHref(orgId, `/invoices/${copy.id}`) as Route);
    },
    onError: (err) => {
      toast({ title: 'Could not duplicate', description: errorMessage(err), tone: 'negative' });
    },
  });
  const paid = parseMinor(invoice.paidMinor) > 0n;

  return (
    <>
      <a
        href={invoicePdfUrl(orgId, invoice.id)}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
      >
        <Download aria-hidden className="size-4" />
        Download PDF
      </a>
      {canWrite && invoice.status === 'issued' ? (
        <Button
          onPress={() => {
            setMatching(true);
          }}
        >
          <Link2 aria-hidden />
          Match payment
        </Button>
      ) : null}
      {canWrite ? (
        <Button
          variant="secondary"
          isPending={duplicate.isPending}
          onPress={() => {
            duplicate.mutate();
          }}
        >
          <Copy aria-hidden />
          Duplicate
        </Button>
      ) : null}
      {canWrite && invoice.status === 'issued' && !paid ? (
        <Button
          variant="ghost"
          onPress={() => {
            setVoiding(true);
          }}
        >
          <Ban aria-hidden />
          Void
        </Button>
      ) : null}
      <MatchPaymentDialog
        orgId={orgId}
        invoice={invoice}
        isOpen={matching}
        onOpenChange={setMatching}
      />
      <VoidDialog orgId={orgId} invoice={invoice} isOpen={voiding} onOpenChange={setVoiding} />
    </>
  );
}

/** Payments allocated to the invoice, each with an Unmatch action. */
export function PaymentList({
  orgId,
  invoice,
  canWrite,
}: {
  orgId: string;
  invoice: InvoiceView;
  canWrite: boolean;
}) {
  const refresh = useRefresh(orgId);
  const unmatch = useMutation({
    mutationFn: (transactionId: string) =>
      unmatchPayment(orgId, invoice.id, transactionId, newIdempotencyKey()),
    onSuccess: async () => {
      toast({ title: 'Payment unmatched', tone: 'positive' });
      await refresh();
    },
    onError: (err) => {
      toast({ title: 'Could not unmatch', description: errorMessage(err), tone: 'negative' });
    },
  });

  if (invoice.payments.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No payment matched yet. When the client pays, import the bank statement and match the
        incoming line here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Matched payments">
      {invoice.payments.map((p) => (
        <li
          key={p.transactionId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">
              <Amount minor={p.amountMinor} currency={invoice.currency} />{' '}
              <span className="text-fg-muted">on {formatIsoDate(p.occurredOn)}</span>
            </span>
            <span className="truncate text-xs text-fg-muted" title={p.description}>
              {p.counterparty ?? 'No counterparty'} · {p.description}
            </span>
          </div>
          {canWrite ? (
            <Button
              size="sm"
              variant="ghost"
              isPending={unmatch.isPending && unmatch.variables === p.transactionId}
              onPress={() => {
                unmatch.mutate(p.transactionId);
              }}
            >
              <Unlink aria-hidden />
              Unmatch
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
