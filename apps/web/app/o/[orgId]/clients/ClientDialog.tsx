'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateClientRequest } from '@geo-ie-accounting/contracts';
import { SUPPORTED_CURRENCIES } from '@geo-ie-accounting/domain';
import { Button, Dialog, DialogFooter, Select, TextField, toast } from '@geo-ie-accounting/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { applyApiError, FormAlert } from '@/components/form-helpers';
import { newIdempotencyKey } from '@/lib/api/browser';
import { type Client, createClient, invoiceKeys, updateClient } from '@/lib/api/invoices';

type Values = z.input<typeof CreateClientRequest>;

const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((c) => ({ id: c, label: c }));
const FIELDS = [
  'name',
  'taxId',
  'address',
  'email',
  'country',
  'defaultCurrency',
  'notes',
] as const satisfies readonly (keyof Values)[];

function toValues(c: Client | null): Values {
  return {
    name: c?.name ?? '',
    taxId: c?.taxId ?? '',
    address: c?.address ?? '',
    email: c?.email ?? '',
    country: c?.country ?? '',
    defaultCurrency: c?.defaultCurrency ?? 'USD',
    notes: c?.notes ?? '',
  };
}

/** Create a client, or edit one when `client` is given. */
export function ClientDialog({
  orgId,
  client,
  isOpen,
  onOpenChange,
  onSaved,
}: {
  orgId: string;
  client: Client | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (client: Client) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const { control, handleSubmit, setError, reset, formState } = useForm<Values>({
    resolver: zodResolver(CreateClientRequest),
    values: toValues(client),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const body = {
        name: values.name,
        country: values.country,
        defaultCurrency: values.defaultCurrency,
        taxId: values.taxId ?? null,
        address: values.address ?? null,
        email: values.email ?? null,
        notes: values.notes ?? null,
      };
      const saved = client
        ? await updateClient(orgId, client.id, body, key)
        : await createClient(orgId, body, key);
      await queryClient.invalidateQueries({ queryKey: invoiceKeys.clients(orgId) });
      toast({ title: client ? 'Client saved' : `Added ${saved.name}`, tone: 'positive' });
      setKey(newIdempotencyKey());
      if (!client) reset();
      onOpenChange(false);
      onSaved?.(saved);
      router.refresh();
    } catch (err) {
      setKey(newIdempotencyKey());
      setFormError(applyApiError(err, setError, FIELDS));
    }
  });

  const text = (
    name: Exclude<(typeof FIELDS)[number], 'defaultCurrency'>,
    label: string,
    extra: { description?: string; isRequired?: boolean } = {},
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={label}
          {...(extra.description ? { description: extra.description } : {})}
          {...(extra.isRequired ? { isRequired: true } : {})}
          value={field.value ?? ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
          isInvalid={fieldState.invalid}
          errorMessage={fieldState.error?.message ?? ''}
        />
      )}
    />
  );

  return (
    <Dialog
      title={client ? 'Edit client' : 'New client'}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        {text('name', 'Name', { isRequired: true })}
        <div className="grid gap-4 sm:grid-cols-2">
          {text('country', 'Country', {
            isRequired: true,
            description: 'Two-letter code, e.g. GE, DE, US.',
          })}
          <Controller
            control={control}
            name="defaultCurrency"
            render={({ field, fieldState }) => (
              <Select
                label="Invoice currency"
                options={CURRENCY_OPTIONS}
                value={field.value}
                onChange={(v) => {
                  if (v) field.onChange(v);
                }}
                isInvalid={fieldState.invalid}
                errorMessage={fieldState.error?.message ?? ''}
              />
            )}
          />
        </div>
        {text('taxId', 'Tax ID', { description: 'Optional. Printed on invoices.' })}
        {text('address', 'Address', { description: 'Optional. Use commas or new lines.' })}
        {text('email', 'Email')}
        {text('notes', 'Notes', { description: 'For you; not printed.' })}
        <DialogFooter>
          <Button
            variant="secondary"
            onPress={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" isPending={formState.isSubmitting}>
            {client ? 'Save' : 'Add client'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
