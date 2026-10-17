'use client';

import {
  computeInvoiceTotals,
  invoiceLineTotal,
  SUPPORTED_CURRENCIES,
} from '@geo-ie-accounting/domain';
import {
  Button,
  Card,
  DatePicker,
  Dialog,
  DialogFooter,
  MoneyInput,
  Select,
  TextField,
  toast,
} from '@geo-ie-accounting/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Send, Trash2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormAlert } from '@/components/form-helpers';
import { isBankAccount } from '@/lib/accounts';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import type { Schemas } from '@/lib/api/client';
import {
  createInvoice,
  deleteInvoice,
  invoiceKeys,
  invoicePdfUrl,
  issueInvoice,
  type Client,
  type InvoiceView,
  updateInvoice,
} from '@/lib/api/invoices';
import { formatMinor } from '@/lib/format';
import { orgHref } from '@/lib/nav';

type Account = Schemas['Account'];

interface LineState {
  key: string;
  description: string;
  quantity: string;
  /** Minor units as the wire string; null while empty. */
  unitPriceMinor: string | null;
}

class NoClientError extends Error {
  constructor() {
    super('Choose a client first.');
  }
}

const QUANTITY = /^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$/;
const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((c) => ({ id: c, label: c }));

let lineSeq = 0;
const newLine = (over: Partial<LineState> = {}): LineState => ({
  key: `line-${++lineSeq}`,
  description: '',
  quantity: '1',
  unitPriceMinor: null,
  ...over,
});

/** Line total from packages/domain, or null while the line cannot be computed yet. */
function lineTotal(line: LineState): bigint | null {
  if (line.unitPriceMinor === null || !QUANTITY.test(line.quantity)) return null;
  try {
    return invoiceLineTotal({
      quantity: line.quantity,
      unitPriceMinor: BigInt(line.unitPriceMinor),
    });
  } catch {
    return null;
  }
}

/**
 * Draft invoice editor with live totals (packages/domain computeInvoiceTotals; the API computes
 * the stored total the same way). Save keeps a draft; Issue saves, then numbers and freezes it.
 */
export function InvoiceEditor({
  orgId,
  invoice,
  clients,
  accounts,
  defaultClientId,
}: {
  orgId: string;
  invoice: InvoiceView | null;
  clients: readonly Client[];
  accounts: readonly Account[];
  defaultClientId?: string | undefined;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const active = clients.filter((c) => c.archivedAt === null || c.id === invoice?.clientId);
  const initialClient =
    active.find((c) => c.id === (invoice?.clientId ?? defaultClientId)) ?? active[0] ?? null;
  const [clientId, setClientId] = useState<string | null>(initialClient?.id ?? null);
  const [currency, setCurrency] = useState(
    invoice?.currency ?? initialClient?.defaultCurrency ?? 'USD',
  );
  const [currencyTouched, setCurrencyTouched] = useState(invoice !== null);
  const [issueDate, setIssueDate] = useState<string | null>(invoice?.issueDate ?? null);
  const [dueDate, setDueDate] = useState<string | null>(invoice?.dueDate ?? null);
  const bankAccounts = accounts.filter((a) => isBankAccount(a) && a.archivedAt === null);
  /** The account a new invoice prints: one in its currency with an IBAN, else any with an IBAN. */
  const pickBank = (cur: string) =>
    bankAccounts.find((a) => a.currency === cur && a.iban)?.id ??
    bankAccounts.find((a) => a.iban)?.id ??
    null;
  const [bankAccountId, setBankAccountId] = useState<string | null>(
    invoice ? invoice.bankAccountId : pickBank(currency),
  );
  const [bankTouched, setBankTouched] = useState(invoice !== null);
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [lines, setLines] = useState<LineState[]>(() =>
    invoice && invoice.lines.length > 0
      ? invoice.lines.map((l) =>
          newLine({
            description: l.description,
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
          }),
        )
      : [newLine()],
  );
  const [busy, setBusy] = useState<'save' | 'issue' | 'delete' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const totals = lines.map(lineTotal);
  const complete = lines.filter((l, i) => l.description.trim() !== '' && totals[i] !== null);
  const total = (() => {
    try {
      return computeInvoiceTotals(
        currency,
        complete.map((l) => ({
          quantity: l.quantity,
          unitPriceMinor: BigInt(l.unitPriceMinor ?? '0'),
        })),
      ).totalMinor;
    } catch {
      return null;
    }
  })();
  const incomplete = lines.length - complete.length;
  const datesInvalid = issueDate !== null && dueDate !== null && dueDate < issueDate;

  const patchLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  function body() {
    return {
      currency,
      issueDate,
      dueDate,
      bankAccountId,
      notes: notes.trim() === '' ? null : notes.trim(),
      lines: lines
        .filter((l) => l.description.trim() !== '' || l.unitPriceMinor !== null)
        .map((l) => ({
          description: l.description.trim(),
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor ?? '0',
        })),
    };
  }

  /** Creates or updates the draft; returns its id. */
  async function save(): Promise<string> {
    if (!clientId) throw new NoClientError();
    const saved = invoice
      ? await updateInvoice(orgId, invoice.id, { clientId, ...body() }, newIdempotencyKey())
      : await createInvoice(orgId, { clientId, ...body() }, newIdempotencyKey());
    await queryClient.invalidateQueries({ queryKey: invoiceKeys.invoices(orgId) });
    return saved.id;
  }

  async function onSave() {
    setFormError(null);
    setBusy('save');
    try {
      const id = await save();
      toast({ title: 'Draft saved', tone: 'positive' });
      if (invoice) router.refresh();
      else router.replace(orgHref(orgId, `/invoices/${id}`) as Route);
    } catch (err) {
      setFormError(err instanceof NoClientError ? err.message : errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onIssue() {
    setFormError(null);
    setBusy('issue');
    try {
      const id = await save();
      const issued = await issueInvoice(orgId, id, {}, newIdempotencyKey());
      setConfirmIssue(false);
      toast({ title: `Issued ${issued.number ?? ''}`, tone: 'positive' });
      router.replace(orgHref(orgId, `/invoices/${id}`) as Route);
      router.refresh();
    } catch (err) {
      setConfirmIssue(false);
      setFormError(err instanceof NoClientError ? err.message : errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!invoice) return;
    setBusy('delete');
    try {
      await deleteInvoice(orgId, invoice.id, newIdempotencyKey());
      await queryClient.invalidateQueries({ queryKey: invoiceKeys.invoices(orgId) });
      toast({ title: 'Draft deleted', tone: 'positive' });
      router.replace(orgHref(orgId, '/invoices') as Route);
      router.refresh();
    } catch (err) {
      setConfirmDelete(false);
      setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (active.length === 0) {
    return (
      <FormAlert>
        Add a client first: invoices are addressed to a client.{' '}
        <a className="underline" href={orgHref(orgId, '/clients')}>
          Open clients
        </a>
      </FormAlert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <Card className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
        <Select
          label="Client"
          options={active.map((c) => ({ id: c.id, label: c.name, description: c.country }))}
          value={clientId}
          onChange={(id) => {
            setClientId(id);
            const c = active.find((x) => x.id === id);
            if (c && !currencyTouched) {
              setCurrency(c.defaultCurrency);
              if (!bankTouched) setBankAccountId(pickBank(c.defaultCurrency));
            }
          }}
        />
        <Select
          label="Currency"
          options={CURRENCY_OPTIONS}
          value={currency}
          onChange={(v) => {
            if (v) {
              setCurrency(v);
              setCurrencyTouched(true);
              if (!bankTouched) setBankAccountId(pickBank(v));
            }
          }}
        />
        <Select
          label="Pay to"
          description="The IBAN printed on the invoice."
          options={[
            { id: 'none', label: 'No bank details' },
            ...bankAccounts.map((a) => ({
              id: a.id,
              label: a.name,
              description: a.iban ?? 'No IBAN on this account',
            })),
          ]}
          value={bankAccountId ?? 'none'}
          onChange={(v) => {
            setBankAccountId(v === 'none' || v === null ? null : v);
            setBankTouched(true);
          }}
        />
        <DatePicker
          label="Issue date"
          description="Empty: the day you issue it."
          value={issueDate}
          onChange={setIssueDate}
        />
        <DatePicker
          label="Due date"
          description="Empty: issue date + your payment terms."
          value={dueDate}
          onChange={setDueDate}
          isInvalid={datesInvalid}
          errorMessage="The due date cannot be before the issue date"
        />
        <TextField
          label="Notes"
          description="Printed on the invoice."
          value={notes}
          onChange={setNotes}
        />
      </Card>

      <section aria-labelledby="lines-heading" className="flex flex-col gap-3">
        <h2 id="lines-heading" className="text-base font-semibold">
          Lines
        </h2>
        <div
          aria-hidden
          className="hidden gap-2 px-3 text-xs font-medium text-fg-muted sm:grid sm:grid-cols-[minmax(0,1fr)_6rem_10rem_8rem_2.5rem]"
        >
          <span>Description</span>
          <span className="text-end">Qty</span>
          <span className="text-end">Unit price</span>
          <span className="text-end">Amount</span>
        </div>
        <ol className="flex flex-col gap-3">
          {lines.map((line, i) => {
            const t = totals[i] ?? null;
            const n = i + 1;
            return (
              <li
                key={line.key}
                className="grid items-start gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_6rem_10rem_8rem_2.5rem]"
              >
                <TextField
                  aria-label={`Description, line ${n}`}
                  placeholder="Description"
                  value={line.description}
                  onChange={(v) => {
                    patchLine(line.key, { description: v });
                  }}
                />
                <TextField
                  aria-label={`Quantity, line ${n}`}
                  placeholder="Qty"
                  inputMode="decimal"
                  inputClassName="text-end tabular-nums"
                  value={line.quantity}
                  onChange={(v) => {
                    patchLine(line.key, { quantity: v.trim() });
                  }}
                  isInvalid={line.quantity !== '' && !QUANTITY.test(line.quantity)}
                  errorMessage="Up to 3 decimals"
                />
                <MoneyInput
                  aria-label={`Unit price, line ${n}`}
                  currency={currency}
                  value={line.unitPriceMinor}
                  onChange={(v) => {
                    patchLine(line.key, { unitPriceMinor: v });
                  }}
                />
                <output
                  aria-label={`Line ${n} total`}
                  className="flex h-10 items-center justify-end text-sm tabular-nums"
                >
                  {t === null ? '—' : formatMinor(t, currency, { display: 'none' })}
                </output>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove line ${n}`}
                  isDisabled={lines.length === 1}
                  onPress={() => {
                    setLines((ls) => ls.filter((l) => l.key !== line.key));
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            onPress={() => {
              setLines((ls) => [...ls, newLine()]);
            }}
          >
            <Plus aria-hidden />
            Add line
          </Button>
          <p className="text-lg font-semibold tabular-nums" aria-live="polite">
            Total {total === null ? '—' : formatMinor(total, currency)}
          </p>
        </div>
        {incomplete > 0 ? (
          <p className="text-xs text-fg-muted">
            {incomplete === 1 ? 'One line is' : `${incomplete} lines are`} not complete yet and not
            in the total.
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          isPending={busy === 'save'}
          isDisabled={busy !== null || datesInvalid}
          onPress={() => void onSave()}
        >
          Save draft
        </Button>
        <Button
          isDisabled={busy !== null || datesInvalid || total === null || total <= 0n}
          onPress={() => {
            setConfirmIssue(true);
          }}
        >
          <Send aria-hidden />
          Issue
        </Button>
        {invoice ? (
          <>
            <a
              className="inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium text-fg hover:bg-surface-muted"
              href={invoicePdfUrl(orgId, invoice.id)}
            >
              <Download aria-hidden className="size-4" />
              Preview PDF
            </a>
            <Button
              variant="ghost"
              isDisabled={busy !== null}
              onPress={() => {
                setConfirmDelete(true);
              }}
            >
              <Trash2 aria-hidden />
              Delete draft
            </Button>
          </>
        ) : null}
      </div>

      <Dialog
        role="alertdialog"
        title="Issue this invoice?"
        description="It gets the next invoice number and can no longer be edited. You can still void it, which keeps the number."
        isOpen={confirmIssue}
        onOpenChange={setConfirmIssue}
        size="sm"
      >
        <p className="text-sm">
          {active.find((c) => c.id === clientId)?.name ?? 'Client'}:{' '}
          <strong className="tabular-nums">
            {total === null ? '—' : formatMinor(total, currency)}
          </strong>
        </p>
        <DialogFooter>
          <Button
            variant="secondary"
            isDisabled={busy === 'issue'}
            onPress={() => {
              setConfirmIssue(false);
            }}
          >
            Cancel
          </Button>
          <Button isPending={busy === 'issue'} onPress={() => void onIssue()}>
            Issue invoice
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        role="alertdialog"
        title="Delete this draft?"
        description="Drafts have no number yet, so nothing is lost from the sequence."
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        size="sm"
      >
        <DialogFooter>
          <Button
            variant="secondary"
            onPress={() => {
              setConfirmDelete(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="danger" isPending={busy === 'delete'} onPress={() => void onDelete()}>
            Delete draft
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
