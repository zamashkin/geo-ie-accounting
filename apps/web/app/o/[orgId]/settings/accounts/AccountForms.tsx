'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateAccountRequest } from '@ie-ledger/contracts';
import { SUPPORTED_CURRENCIES } from '@ie-ledger/domain';
import { Button, Dialog, DialogFooter, Select, TextField, toast } from '@ie-ledger/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { applyApiError, FormAlert } from '@/components/form-helpers';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import { type Account, createAccount, ledgerKeys, updateAccount } from '@/lib/api/ledger';

type CreateValues = z.input<typeof CreateAccountRequest>;

const KIND_OPTIONS = [
  { id: 'asset', label: 'Bank or cash account', description: 'Money you hold, in one currency' },
  { id: 'income', label: 'Income', description: 'What clients pay you' },
  { id: 'expense', label: 'Expense', description: 'What the business spends' },
  { id: 'liability', label: 'Liability', description: 'What the business owes' },
  { id: 'equity', label: 'Equity', description: "The owner's stake" },
] as const;

const INCOME_CLASS_OPTIONS = [
  {
    id: 'sbs',
    label: 'Small-business income',
    description: 'Declared monthly at the 1% rate, counts toward the GEL 500,000 limit',
  },
  { id: 'non_sbs', label: 'Other income', description: 'Not declared (rental, interest, …)' },
] as const;

const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((c) => ({ id: c, label: c }));

/** Accounts list and balances are cached under the accounts key; refresh both. */
function useInvalidateAccounts(orgId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ledgerKeys.accounts(orgId) });
}

export function NewAccountDialog({
  orgId,
  isOpen,
  onOpenChange,
}: {
  orgId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invalidate = useInvalidateAccounts(orgId);
  const [formError, setFormError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const { control, handleSubmit, setError, reset, formState } = useForm<CreateValues>({
    resolver: zodResolver(CreateAccountRequest),
    defaultValues: { name: '', kind: 'asset', currency: 'GEL', iban: null, incomeClass: null },
  });
  const kind = useWatch({ control, name: 'kind' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const account = await createAccount(
        orgId,
        {
          name: values.name,
          kind: values.kind,
          ...(values.kind === 'asset' ? { currency: values.currency ?? null } : {}),
          ...(values.kind === 'asset' && values.iban ? { iban: values.iban } : {}),
          ...(values.kind === 'income' ? { incomeClass: values.incomeClass ?? null } : {}),
        },
        key,
      );
      await invalidate();
      toast({ title: `Created ${account.name}`, tone: 'positive' });
      reset();
      setKey(newIdempotencyKey());
      onOpenChange(false);
    } catch (err) {
      setKey(newIdempotencyKey());
      setFormError(applyApiError(err, setError, ['name', 'currency', 'iban', 'incomeClass']));
    }
  });

  return (
    <Dialog title="New account" isOpen={isOpen} onOpenChange={onOpenChange}>
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <Select
              label="Type"
              options={KIND_OPTIONS}
              value={field.value}
              onChange={(v) => {
                if (v) field.onChange(v);
              }}
            />
          )}
        />
        <Controller
          control={control}
          name="name"
          render={({ field, fieldState }) => (
            <TextField
              label="Name"
              isRequired
              {...(kind === 'asset' ? { description: 'For example “TBC USD” or “Cash GEL”.' } : {})}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              isInvalid={fieldState.invalid}
              errorMessage={fieldState.error?.message ?? ''}
            />
          )}
        />
        {kind === 'asset' ? (
          <>
            <Controller
              control={control}
              name="currency"
              render={({ field, fieldState }) => (
                <Select
                  label="Currency"
                  options={CURRENCY_OPTIONS}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  isInvalid={fieldState.invalid}
                  errorMessage={fieldState.error?.message ?? ''}
                />
              )}
            />
            <Controller
              control={control}
              name="iban"
              render={({ field, fieldState }) => (
                <TextField
                  label="IBAN"
                  description="Optional. Statement uploads find the account by IBAN and currency."
                  value={field.value ?? ''}
                  onChange={(v) => {
                    const iban = v.replace(/\s+/g, '').toUpperCase();
                    field.onChange(iban === '' ? null : iban);
                  }}
                  onBlur={field.onBlur}
                  isInvalid={fieldState.invalid}
                  errorMessage={fieldState.error?.message ?? ''}
                  inputClassName="font-mono"
                />
              )}
            />
          </>
        ) : null}
        {kind === 'income' ? (
          <Controller
            control={control}
            name="incomeClass"
            render={({ field, fieldState }) => (
              <Select
                label="Income class"
                options={INCOME_CLASS_OPTIONS}
                value={field.value ?? null}
                onChange={field.onChange}
                isInvalid={fieldState.invalid}
                errorMessage={fieldState.error?.message ?? ''}
              />
            )}
          />
        ) : null}
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
            Create account
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export function RenameAccountDialog({
  orgId,
  account,
  onClose,
}: {
  orgId: string;
  account: Account | null;
  onClose: () => void;
}) {
  const invalidate = useInvalidateAccounts(orgId);
  const [name, setName] = useState(account?.name ?? '');
  const [prevId, setPrevId] = useState(account?.id);
  if (account?.id !== prevId) {
    setPrevId(account?.id);
    setName(account?.name ?? '');
  }
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string; key: string }) =>
      updateAccount(orgId, v.id, { name: v.name }, v.key),
    onSuccess: async () => {
      await invalidate();
      toast({ title: 'Renamed', tone: 'positive' });
      onClose();
    },
  });

  return (
    <Dialog
      title="Rename account"
      isOpen={account !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="sm"
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (account && name.trim() !== '') {
            rename.mutate({ id: account.id, name: name.trim(), key: newIdempotencyKey() });
          }
        }}
      >
        {rename.isError ? <FormAlert>{errorMessage(rename.error)}</FormAlert> : null}
        <TextField
          label="Name"
          isRequired
          value={name}
          onChange={setName}
          isInvalid={name.trim() === ''}
          errorMessage="Enter a name"
        />
        <DialogFooter>
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button type="submit" isPending={rename.isPending}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
