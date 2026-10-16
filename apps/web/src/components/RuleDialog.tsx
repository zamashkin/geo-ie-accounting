'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateRuleRequest } from '@ie-ledger/contracts';
import { SUPPORTED_CURRENCIES } from '@ie-ledger/domain';
import { Button, Dialog, DialogFooter, MoneyInput, Select, TextField } from '@ie-ledger/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { applyApiError, FormAlert } from '@/components/form-helpers';
import { accountOptions, accountRole } from '@/lib/accounts';
import { newIdempotencyKey } from '@/lib/api/browser';
import { accountsQuery, createRule, type Rule, type RuleInput, updateRule } from '@/lib/api/ledger';

type Values = z.input<typeof CreateRuleRequest>;

const ANY = 'any';
const DIRECTIONS = [
  { id: ANY, label: 'Money in or out' },
  { id: 'in', label: 'Money in' },
  { id: 'out', label: 'Money out' },
];
const CURRENCIES = [
  { id: ANY, label: 'Any currency' },
  ...SUPPORTED_CURRENCIES.map((c) => ({ id: c, label: c })),
];

function toValues(rule: Partial<RuleInput>): Values {
  return {
    name: rule.name ?? '',
    counterpartyContains: rule.counterpartyContains ?? '',
    descriptionContains: rule.descriptionContains ?? '',
    direction: rule.direction ?? null,
    currency: rule.currency ?? null,
    amountMinMinor: rule.amountMinMinor ?? null,
    amountMaxMinor: rule.amountMaxMinor ?? null,
    targetAccountId: rule.targetAccountId ?? '',
    isActive: rule.isActive ?? true,
  };
}

const FIELDS = [
  'name',
  'counterpartyContains',
  'descriptionContains',
  'currency',
  'amountMinMinor',
  'amountMaxMinor',
  'targetAccountId',
] as const;

/**
 * Create or edit a categorisation rule. `rule` edits it; otherwise `initial` prefills a new one
 * (e.g. from an import row). The form is checked with the contracts schema; the API adds the
 * checks that need the database (account, at least one condition).
 */
export function RuleDialog({
  isOpen,
  onOpenChange,
  title,
  ...props
}: RuleFormProps & {
  isOpen: boolean;
  title?: string;
}) {
  return (
    <Dialog
      title={title ?? (props.rule ? 'Edit rule' : 'New rule')}
      description="Imported lines that meet every condition you set are booked against the account. Empty conditions match anything."
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
    >
      {/* Mounted while open, so every opening starts from the rule or the prefill. */}
      <RuleForm {...props} onOpenChange={onOpenChange} />
    </Dialog>
  );
}

interface RuleFormProps {
  orgId: string;
  onOpenChange: (open: boolean) => void;
  rule?: Rule | undefined;
  initial?: Partial<RuleInput> | undefined;
  onSaved: (rule: Rule) => void | Promise<void>;
}

function RuleForm({ orgId, onOpenChange, rule, initial, onSaved }: RuleFormProps) {
  const accounts = useQuery(accountsQuery(orgId));
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, getValues, formState } = useForm<
    Values,
    unknown,
    z.output<typeof CreateRuleRequest>
  >({
    resolver: zodResolver(CreateRuleRequest),
    defaultValues: toValues(rule ?? initial ?? {}),
  });
  const currency = useWatch({ control, name: 'currency' });
  const targetAccountId = useWatch({ control, name: 'targetAccountId' });
  const target = accounts.data?.find((a) => a.id === targetAccountId);

  const onSubmit = handleSubmit(async () => {
    setFormError(null);
    // The resolver checked the values; the wire body is the raw input (strings, not bigint).
    const raw = getValues();
    const body: RuleInput = {
      name: raw.name,
      counterpartyContains: raw.counterpartyContains ?? null,
      descriptionContains: raw.descriptionContains ?? null,
      direction: raw.direction ?? null,
      currency: raw.currency ?? null,
      amountMinMinor: raw.currency ? (raw.amountMinMinor ?? null) : null,
      amountMaxMinor: raw.currency ? (raw.amountMaxMinor ?? null) : null,
      targetAccountId: raw.targetAccountId,
      isActive: raw.isActive ?? true,
    };
    try {
      const saved = rule
        ? await updateRule(orgId, rule.id, body, newIdempotencyKey())
        : await createRule(orgId, body, newIdempotencyKey());
      await onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setFormError(applyApiError(err, setError, FIELDS));
    }
  });

  const options = accountOptions(
    accounts.data ?? [],
    (a) =>
      a.systemKey !== 'tax_payable' &&
      (!currency || a.currency === null || a.currency === currency),
  );

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField
            label="Rule name"
            isRequired
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            isInvalid={fieldState.invalid}
            errorMessage={fieldState.error?.message ?? ''}
          />
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="counterpartyContains"
          render={({ field, fieldState }) => (
            <TextField
              label="Counterparty contains"
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              isInvalid={fieldState.invalid}
              errorMessage={fieldState.error?.message ?? ''}
            />
          )}
        />
        <Controller
          control={control}
          name="descriptionContains"
          render={({ field, fieldState }) => (
            <TextField
              label="Details contain"
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              isInvalid={fieldState.invalid}
              errorMessage={fieldState.error?.message ?? ''}
            />
          )}
        />
        <Controller
          control={control}
          name="direction"
          render={({ field }) => (
            <Select
              label="Direction"
              options={DIRECTIONS}
              value={field.value ?? ANY}
              onChange={(v) => {
                field.onChange(v === 'in' || v === 'out' ? v : null);
              }}
            />
          )}
        />
        <Controller
          control={control}
          name="currency"
          render={({ field, fieldState }) => (
            <Select
              label="Currency"
              options={CURRENCIES}
              value={field.value ?? ANY}
              onChange={(v) => {
                field.onChange(v && v !== ANY ? v : null);
              }}
              isInvalid={fieldState.invalid}
              errorMessage={fieldState.error?.message ?? ''}
            />
          )}
        />
        {currency ? (
          <>
            <Controller
              control={control}
              name="amountMinMinor"
              render={({ field, fieldState }) => (
                <MoneyInput
                  label="Amount at least"
                  description="Without sign; empty for no lower bound."
                  currency={currency}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  isInvalid={fieldState.invalid}
                  errorMessage={fieldState.error?.message ?? ''}
                />
              )}
            />
            <Controller
              control={control}
              name="amountMaxMinor"
              render={({ field, fieldState }) => (
                <MoneyInput
                  label="Amount at most"
                  description="Empty for no upper bound."
                  currency={currency}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  isInvalid={fieldState.invalid}
                  errorMessage={fieldState.error?.message ?? ''}
                />
              )}
            />
          </>
        ) : null}
      </div>
      <Controller
        control={control}
        name="targetAccountId"
        render={({ field, fieldState }) => (
          <Select
            label="Book against"
            placeholder="Choose account"
            options={options}
            value={field.value || null}
            onChange={(v) => {
              field.onChange(v ?? '');
            }}
            {...(target ? { description: accountRole(target) } : {})}
            isInvalid={fieldState.invalid}
            errorMessage={fieldState.invalid ? 'Choose an account' : ''}
          />
        )}
      />
      <Controller
        control={control}
        name="isActive"
        render={({ field }) => (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={field.value ?? true}
              onChange={(e) => {
                field.onChange(e.target.checked);
              }}
            />
            Active
          </label>
        )}
      />
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
          {rule ? 'Save rule' : 'Create rule'}
        </Button>
      </DialogFooter>
    </form>
  );
}
