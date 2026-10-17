'use client';

import { formatInvoiceNumber, INVOICE_PREFIX_PATTERN } from '@ie-ledger/domain';
import { Button, TextField, toast } from '@ie-ledger/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormAlert } from '@/components/form-helpers';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import type { Schemas } from '@/lib/api/client';
import { updateOrganization } from '@/lib/api/ledger';

type Org = Schemas['OrganizationWithRole'];

const text = (v: string) => (v.trim() === '' ? null : v.trim());

/** The seller details every invoice prints, and how invoices are numbered. Owner only. */
export function InvoiceProfileForm({ org }: { org: Org }) {
  const router = useRouter();
  const [v, setV] = useState({
    name: org.name,
    taxId: org.taxId ?? '',
    address: org.address ?? '',
    email: org.email ?? '',
    phone: org.phone ?? '',
    invoicePrefix: org.invoicePrefix ?? '',
    invoiceDueDays: String(org.invoiceDueDays),
    invoiceNote: org.invoiceNote ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (value: string) => {
    setV((prev) => ({ ...prev, [k]: value }));
  };

  const prefixOk = INVOICE_PREFIX_PATTERN.test(v.invoicePrefix.trim());
  const dueDays = /^[0-9]{1,3}$/.test(v.invoiceDueDays) ? Number(v.invoiceDueDays) : NaN;
  const dueOk = Number.isInteger(dueDays) && dueDays >= 0 && dueDays <= 365;
  const year = new Date().getFullYear();
  const example = prefixOk ? formatInvoiceNumber(text(v.invoicePrefix), year, 1) : '—';

  async function onSubmit() {
    setError(null);
    setSaving(true);
    try {
      await updateOrganization(
        org.id,
        {
          name: v.name.trim(),
          taxId: text(v.taxId),
          address: text(v.address),
          email: text(v.email),
          phone: text(v.phone),
          invoicePrefix: text(v.invoicePrefix),
          invoiceDueDays: dueDays,
          invoiceNote: text(v.invoiceNote),
        },
        newIdempotencyKey(),
      );
      toast({
        title: 'Saved',
        description: 'New invoices use these details. Issued ones keep theirs.',
        tone: 'positive',
      });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name on invoices"
          description="Your registered name, e.g. ი/მ გიორგი ბერიძე."
          isRequired
          value={v.name}
          onChange={set('name')}
          isInvalid={v.name.trim() === ''}
          errorMessage="Enter a name"
        />
        <TextField
          label="Tax ID"
          description="Personal or registration number."
          value={v.taxId}
          onChange={set('taxId')}
        />
        <TextField
          label="Address"
          value={v.address}
          onChange={set('address')}
          className="sm:col-span-2"
        />
        <TextField label="Email" type="email" value={v.email} onChange={set('email')} />
        <TextField label="Phone" type="tel" value={v.phone} onChange={set('phone')} />
        <TextField
          label="Number prefix"
          description={`Optional. Next number looks like ${example}.`}
          value={v.invoicePrefix}
          onChange={set('invoicePrefix')}
          isInvalid={!prefixOk}
          errorMessage="Up to 16 letters, digits or - / . _"
        />
        <TextField
          label="Payment terms (days)"
          description="Due date when an invoice is issued without one."
          inputMode="numeric"
          value={v.invoiceDueDays}
          onChange={set('invoiceDueDays')}
          isInvalid={!dueOk}
          errorMessage="0 to 365 days"
        />
        <TextField
          label="Invoice note"
          description="Printed at the foot of every invoice, e.g. “Not registered for VAT”."
          value={v.invoiceNote}
          onChange={set('invoiceNote')}
          className="sm:col-span-2"
        />
      </div>
      <div>
        <Button
          type="submit"
          isPending={saving}
          isDisabled={!prefixOk || !dueOk || v.name.trim() === ''}
        >
          Save invoice details
        </Button>
      </div>
    </form>
  );
}
