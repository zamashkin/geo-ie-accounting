import { z } from 'zod';
import { AccountKind, Bank, IncomeClass } from './enums';
import { PostingRate } from './ledger';
import { CurrencyCode, Iban, IsoDate, MinorUnits, Uuid } from './primitives';
import { OrgParams } from './tenancy';

// Accounts management (WS-06): list with balances, create, rename, archive.
// All under /v1/orgs/:orgId/accounts.

export const AccountParams = OrgParams.extend({ accountId: Uuid });
export type AccountParams = z.output<typeof AccountParams>;

/** `?includeArchived=true` also lists archived accounts (the accounts page shows them). */
export const ListAccountsQuery = z.object({
  includeArchived: z.enum(['true', 'false']).optional(),
});
export type ListAccountsQuery = z.output<typeof ListAccountsQuery>;

/**
 * `POST /accounts`. An `asset` account is a bank (or cash) account: it needs a currency and may
 * carry an IBAN and bank. An `income` account needs its class (`sbs` counts toward the 1% tax
 * and the limit). System accounts (FX Clearing, Tax Payable, Owner Equity) cannot be created.
 */
export const CreateAccountRequest = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: AccountKind,
    currency: CurrencyCode.nullable().optional(),
    incomeClass: IncomeClass.nullable().optional(),
    bank: Bank.nullable().optional(),
    iban: Iban.nullable().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.kind === 'asset' && !b.currency) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'A bank account needs a currency',
      });
    }
    if (b.kind === 'income' && !b.incomeClass) {
      ctx.addIssue({ code: 'custom', path: ['incomeClass'], message: 'Choose the income class' });
    }
    if (b.kind !== 'income' && b.incomeClass) {
      ctx.addIssue({
        code: 'custom',
        path: ['incomeClass'],
        message: 'Only income accounts have an income class',
      });
    }
    if (b.kind !== 'asset' && (b.iban || b.bank)) {
      ctx.addIssue({
        code: 'custom',
        path: [b.iban ? 'iban' : 'bank'],
        message: 'Only bank accounts have an IBAN or bank',
      });
    }
  })
  .meta({ id: 'CreateAccountRequest' });
export type CreateAccountRequest = z.output<typeof CreateAccountRequest>;

/**
 * `PATCH /accounts/:accountId`: rename, archive (`archived: true`) or restore. A bank account
 * with a non-zero balance cannot be archived; system accounts cannot be archived at all.
 */
export const UpdateAccountRequest = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  })
  .refine((b) => b.name !== undefined || b.archived !== undefined, {
    message: 'Send name, archived or both',
  })
  .meta({ id: 'UpdateAccountRequest' });
export type UpdateAccountRequest = z.output<typeof UpdateAccountRequest>;

/** Sum of an account's postings in one currency. */
export const CurrencyBalance = z
  .object({
    currency: CurrencyCode,
    /**
     * On the account's normal side: positive is a debit balance for asset and expense accounts
     * and a credit balance for liability, equity and income accounts.
     */
    amountMinor: MinorUnits,
  })
  .meta({ id: 'CurrencyBalance' });
export type CurrencyBalance = z.output<typeof CurrencyBalance>;

export const AccountBalance = z
  .object({
    accountId: Uuid,
    /** Non-zero balances only, by currency code. Empty: nothing booked, or it nets to zero. */
    balances: z.array(CurrencyBalance),
    /**
     * Bank accounts only: the balance in GEL at the latest stored NBG rate on or before `asOf`
     * (`rate` null for GEL). null for other accounts, or when no rate is stored yet.
     */
    gelValue: z.object({ amountMinor: MinorUnits, rate: PostingRate.nullable() }).nullable(),
  })
  .meta({ id: 'AccountBalance' });
export type AccountBalance = z.output<typeof AccountBalance>;

/** `GET /accounts/balances`: every account of the org, archived ones included. */
export const AccountBalanceList = z
  .object({
    items: z.array(AccountBalance),
    /** Today in Tbilisi: the date the GEL values are for. */
    asOf: IsoDate,
    /** Sum of the bank accounts' `gelValue`. */
    bankTotalGelMinor: MinorUnits,
    /** Bank accounts with a balance but no stored rate, left out of the total. */
    bankAccountsWithoutRate: z.array(Uuid),
  })
  .meta({ id: 'AccountBalanceList' });
export type AccountBalanceList = z.output<typeof AccountBalanceList>;
