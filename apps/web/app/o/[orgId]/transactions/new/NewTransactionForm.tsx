'use client';

import { SUPPORTED_CURRENCIES } from '@geo-ie-accounting/domain';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DatePicker,
  MoneyInput,
  Select,
  SkeletonText,
  TextField,
  toast,
} from '@geo-ie-accounting/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { type Control, Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Amount } from '@/components/Amount';
import { applyApiError, FormAlert } from '@/components/form-helpers';
import { Notice } from '@/components/Notice';
import { accountOptions, isBankAccount } from '@/lib/accounts';
import { errorMessage, isApiError } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import {
  type Account,
  accountsQuery,
  createTransaction,
  ledgerKeys,
  previewTransaction,
  type TransactionPreview,
} from '@/lib/api/ledger';
import { formatIsoDate } from '@/lib/format';
import { PAYMENT_METHOD_LABELS } from '@/lib/labels';
import { orgHref } from '@/lib/nav';
import {
  emptyValues,
  isComplete,
  toRequest,
  type TransactionFormValues,
  transactionResolver,
  type TransactionType,
  TYPE_LABELS,
} from './transaction-form';

type Values = TransactionFormValues;

const PAYMENT_METHODS = Object.entries(PAYMENT_METHOD_LABELS).map(([id, label]) => ({ id, label }));
const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((c) => ({ id: c, label: c }));

/** Today in Tbilisi, `YYYY-MM-DD`. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(new Date());
}

/** `value` once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return debounced;
}

function AccountField({
  control,
  name,
  label,
  options,
  description,
}: {
  control: Control<Values>;
  name: 'bankAccountId' | 'incomeAccountId' | 'expenseAccountId' | 'fromAccountId' | 'toAccountId';
  label: string;
  options: ReturnType<typeof accountOptions>;
  description?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Select
          label={label}
          placeholder="Choose account"
          options={options}
          value={field.value || null}
          onChange={(v) => {
            field.onChange(v ?? '');
          }}
          {...(description ? { description } : {})}
          isInvalid={fieldState.invalid}
          errorMessage={fieldState.error?.message ?? ''}
        />
      )}
    />
  );
}

function AmountField({
  control,
  name,
  label,
  currency,
}: {
  control: Control<Values>;
  name: 'amountMinor' | 'soldAmountMinor' | 'boughtAmountMinor';
  label: string;
  currency: string | undefined;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <MoneyInput
          label={label}
          currency={currency ?? 'GEL'}
          {...(currency ? {} : { description: 'Choose the account first: it sets the currency.' })}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          isInvalid={fieldState.invalid}
          errorMessage={fieldState.error?.message ?? ''}
        />
      )}
    />
  );
}

function PostingsFields({ control, accounts }: { control: Control<Values>; accounts: Account[] }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'postings' });
  const options = accountOptions(accounts, () => true);
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">Postings</legend>
      <p className="text-xs text-fg-muted">
        Positive amounts are debits, negative are credits. They must sum to zero in each currency.
      </p>
      {fields.map((f, i) => (
        <div
          key={f.id}
          className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[minmax(0,2fr)_6rem_minmax(0,1fr)_auto] sm:items-end"
        >
          <Controller
            control={control}
            name={`postings.${i}.accountId`}
            render={({ field, fieldState }) => (
              <Select
                label={`Account ${i + 1}`}
                placeholder="Choose account"
                options={options}
                value={field.value || null}
                onChange={(v) => {
                  field.onChange(v ?? '');
                }}
                isInvalid={fieldState.invalid}
                errorMessage={fieldState.error?.message ?? ''}
              />
            )}
          />
          <Controller
            control={control}
            name={`postings.${i}.currency`}
            render={({ field }) => (
              <Select
                label="Currency"
                options={CURRENCY_OPTIONS}
                value={field.value}
                onChange={(v) => {
                  if (v) field.onChange(v);
                }}
              />
            )}
          />
          <PostingAmount control={control} index={i} />
          <Button
            variant="ghost"
            size="sm"
            isDisabled={fields.length <= 2}
            aria-label={`Remove posting ${i + 1}`}
            onPress={() => {
              remove(i);
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => {
            append({ accountId: '', currency: 'GEL', amountMinor: null });
          }}
        >
          Add posting
        </Button>
      </div>
    </fieldset>
  );
}

function PostingAmount({ control, index }: { control: Control<Values>; index: number }) {
  const currency = useWatch({ control, name: `postings.${index}.currency` });
  return (
    <Controller
      control={control}
      name={`postings.${index}.amountMinor`}
      render={({ field, fieldState }) => (
        <MoneyInput
          label="Amount"
          currency={currency}
          allowNegative
          value={field.value}
          onChange={field.onChange}
          isInvalid={fieldState.invalid}
          errorMessage={fieldState.error?.message ?? ''}
        />
      )}
    />
  );
}

function PreviewPanel({
  preview,
  error,
  isFetching,
  complete,
}: {
  preview: TransactionPreview | undefined;
  error: Error | null;
  isFetching: boolean;
  complete: boolean;
}) {
  if (!complete) {
    return (
      <p className="text-sm text-fg-muted">
        Fill in the form to see the postings and the GEL equivalent at the NBG rate of the date.
      </p>
    );
  }
  if (error) {
    if (isApiError(error) && error.code === 'rate_unavailable') {
      return (
        <Notice tone="warning" title="NBG rate not available">
          {error.problem.detail} Pick another date or try again later.
        </Notice>
      );
    }
    return <Notice tone="error">{errorMessage(error)}</Notice>;
  }
  if (!preview) return <SkeletonText lines={3} />;
  const converted = preview.postings.filter((p) => p.rate !== null);
  return (
    <div className="flex flex-col gap-3" aria-busy={isFetching} data-testid="transaction-preview">
      {converted.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {[...new Map(converted.map((p) => [p.currency, p])).values()].map((p) => (
            <li key={p.currency}>
              NBG rate{' '}
              <span className="font-medium tabular-nums">
                {p.rate?.rate} GEL per {p.rate?.quantity} {p.currency}
              </span>
              , rate date{' '}
              <time dateTime={p.rate?.validFrom} className="font-medium">
                {p.rate ? formatIsoDate(p.rate.validFrom) : ''}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">In GEL: no conversion needed.</p>
      )}
      <table className="w-full text-sm">
        <caption className="sr-only">Postings to be booked</caption>
        <thead>
          <tr className="text-left text-xs text-fg-muted">
            <th className="py-1 font-medium">Account</th>
            <th className="py-1 text-end font-medium">Amount</th>
            <th className="py-1 text-end font-medium">GEL</th>
          </tr>
        </thead>
        <tbody>
          {preview.postings.map((p, i) => (
            <tr key={`${p.accountId}-${i}`} className="border-t border-line">
              <td className="py-1.5">
                {p.account.name}{' '}
                {p.account.incomeClass === 'sbs' ? <Badge tone="accent">SBS income</Badge> : null}
              </td>
              <td className="py-1.5 text-end">
                <Amount minor={p.amountMinor} currency={p.currency} tone="signed" />
              </td>
              <td className="py-1.5 text-end">
                <Amount minor={p.gelAmountMinor} currency="GEL" display="none" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.paymentMethod ? (
        <p className="text-xs text-fg-muted">
          Payment method: {PAYMENT_METHOD_LABELS[preview.paymentMethod]}
        </p>
      ) : null}
    </div>
  );
}

export function NewTransactionForm({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accountsQ = useQuery(accountsQuery(orgId));
  const [formError, setFormError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const { control, handleSubmit, setError, formState } = useForm<Values>({
    resolver: transactionResolver,
    defaultValues: emptyValues(today()),
  });
  const values = useWatch({ control }) as Values;
  const type = values.type;

  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const currencyOf = (id: string) => byId.get(id)?.currency ?? undefined;
  const banks = accountOptions(accounts, isBankAccount);
  const gelBanks = accountOptions(accounts, (a) => isBankAccount(a) && a.currency === 'GEL');
  const incomeAccounts = accountOptions(accounts, (a) => a.kind === 'income');
  const expenseAccounts = accountOptions(accounts, (a) => a.kind === 'expense');

  // Preview what would be booked once the form is complete, after typing pauses.
  const request = isComplete(values) ? JSON.stringify(toRequest(values)) : null;
  const debounced = useDebounced(request, 400);
  const preview = useQuery({
    queryKey: ['org', orgId, 'transaction-preview', debounced],
    queryFn: ({ signal }) =>
      previewTransaction(
        orgId,
        JSON.parse(debounced ?? '{}') as ReturnType<typeof toRequest>,
        signal,
      ),
    enabled: debounced !== null && debounced === request,
    retry: false,
    staleTime: 60_000,
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const created = await createTransaction(orgId, toRequest(v), key);
      await queryClient.invalidateQueries({ queryKey: ledgerKeys.transactions(orgId) });
      await queryClient.invalidateQueries({ queryKey: ledgerKeys.accounts(orgId) });
      toast({ title: 'Transaction booked', tone: 'positive' });
      router.push(orgHref(orgId, `/transactions?tx=${created.id}`) as Route);
    } catch (err) {
      setKey(newIdempotencyKey());
      setFormError(
        applyApiError(err, setError, [
          'occurredOn',
          'description',
          'bankAccountId',
          'incomeAccountId',
          'expenseAccountId',
          'fromAccountId',
          'toAccountId',
          'amountMinor',
          'soldAmountMinor',
          'boughtAmountMinor',
          'paymentMethod',
        ]),
      );
    }
  });

  const typeOptions = (Object.keys(TYPE_LABELS) as TransactionType[])
    .filter((t) => t !== 'postings' || isOwner)
    .map((t) => ({ id: t, ...TYPE_LABELS[t] }));

  if (accountsQ.isPending) return <SkeletonText lines={6} />;

  return (
    <form
      noValidate
      className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start"
      onSubmit={(e) => void onSubmit(e)}
    >
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <Select
              label="What happened"
              options={typeOptions}
              value={field.value}
              onChange={(v) => {
                if (v) field.onChange(v);
              }}
            />
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={control}
            name="occurredOn"
            render={({ field, fieldState }) => (
              <DatePicker
                label="Date"
                value={field.value}
                onChange={field.onChange}
                maxValue={today()}
                isInvalid={fieldState.invalid}
                errorMessage={fieldState.error?.message ?? ''}
              />
            )}
          />
          <Controller
            control={control}
            name="description"
            render={({ field, fieldState }) => (
              <TextField
                label="Description"
                isRequired
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
                errorMessage={fieldState.error?.message ?? ''}
              />
            )}
          />
        </div>

        {type === 'income' ? (
          <>
            <AccountField
              control={control}
              name="bankAccountId"
              label="Received in"
              options={banks}
            />
            <AccountField
              control={control}
              name="incomeAccountId"
              label="Income account"
              options={incomeAccounts}
            />
            <AmountField
              control={control}
              name="amountMinor"
              label="Amount"
              currency={currencyOf(values.bankAccountId)}
            />
            <Controller
              control={control}
              name="paymentMethod"
              render={({ field }) => (
                <Select
                  label="Payment method"
                  description="The line of the declaration small-business income goes on."
                  options={PAYMENT_METHODS}
                  value={field.value ?? 'bank'}
                  onChange={field.onChange}
                />
              )}
            />
          </>
        ) : null}
        {type === 'expense' ? (
          <>
            <AccountField
              control={control}
              name="bankAccountId"
              label="Paid from"
              options={banks}
            />
            <AccountField
              control={control}
              name="expenseAccountId"
              label="Expense account"
              options={expenseAccounts}
            />
            <AmountField
              control={control}
              name="amountMinor"
              label="Amount"
              currency={currencyOf(values.bankAccountId)}
            />
          </>
        ) : null}
        {type === 'owner_draw' || type === 'owner_contribution' ? (
          <>
            <AccountField
              control={control}
              name="bankAccountId"
              label={type === 'owner_draw' ? 'Taken from' : 'Paid into'}
              options={banks}
              description="Booked against Owner Equity: not income and not an expense."
            />
            <AmountField
              control={control}
              name="amountMinor"
              label="Amount"
              currency={currencyOf(values.bankAccountId)}
            />
          </>
        ) : null}
        {type === 'tax_payment' ? (
          <>
            <AccountField
              control={control}
              name="bankAccountId"
              label="Paid from"
              options={gelBanks}
            />
            <AmountField control={control} name="amountMinor" label="Tax paid" currency="GEL" />
          </>
        ) : null}
        {type === 'transfer' ? (
          <>
            <AccountField control={control} name="fromAccountId" label="From" options={banks} />
            <AccountField
              control={control}
              name="toAccountId"
              label="To"
              options={accountOptions(
                accounts,
                (a) =>
                  isBankAccount(a) &&
                  a.id !== values.fromAccountId &&
                  (!currencyOf(values.fromAccountId) ||
                    a.currency === currencyOf(values.fromAccountId)),
              )}
            />
            <AmountField
              control={control}
              name="amountMinor"
              label="Amount"
              currency={currencyOf(values.fromAccountId)}
            />
          </>
        ) : null}
        {type === 'fx_conversion' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <AccountField
                control={control}
                name="fromAccountId"
                label="Sold from"
                options={banks}
              />
              <AmountField
                control={control}
                name="soldAmountMinor"
                label="Amount sold"
                currency={currencyOf(values.fromAccountId)}
              />
              <AccountField
                control={control}
                name="toAccountId"
                label="Bought into"
                options={accountOptions(
                  accounts,
                  (a) => isBankAccount(a) && a.currency !== currencyOf(values.fromAccountId),
                )}
              />
              <AmountField
                control={control}
                name="boughtAmountMinor"
                label="Amount bought"
                currency={currencyOf(values.toAccountId)}
              />
            </div>
            <p className="text-xs text-fg-muted">
              Each side is converted at the NBG rate of the date, through FX Clearing. Not income.
            </p>
          </>
        ) : null}
        {type === 'postings' ? (
          <>
            <PostingsFields control={control} accounts={accounts} />
            <Controller
              control={control}
              name="paymentMethod"
              render={({ field, fieldState }) => (
                <Select
                  label="Payment method"
                  description="Needed when a posting is on small-business income."
                  options={[{ id: 'none', label: 'None' }, ...PAYMENT_METHODS]}
                  value={field.value ?? 'none'}
                  onChange={(v) => {
                    field.onChange(v && v !== 'none' ? v : null);
                  }}
                  isInvalid={fieldState.invalid}
                  errorMessage={fieldState.error?.message ?? ''}
                />
              )}
            />
          </>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" isPending={formState.isSubmitting}>
            Book transaction
          </Button>
          <ButtonLink variant="ghost" href={orgHref(orgId, '/transactions')}>
            Cancel
          </ButtonLink>
        </div>
      </Card>
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold">Before you book</h2>
        <PreviewPanel
          preview={preview.data}
          error={debounced === request ? preview.error : null}
          isFetching={preview.isFetching}
          complete={request !== null}
        />
      </Card>
    </form>
  );
}
