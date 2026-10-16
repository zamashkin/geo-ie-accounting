// Manual transactions (WS-06): request → domain event builder → TransactionDraft. Accounts are
// checked here (kind, currency, archived); the arithmetic and the balance check are domain's.
import type { CreateTransactionRequest, TransactionPreview } from '@ie-ledger/contracts';
import type { AccountRow, ExchangeRateRow } from '@ie-ledger/db';
import {
  BASE_CURRENCY,
  DomainError,
  expense,
  formatRate,
  fxConversion,
  incomeReceipt,
  isSupportedCurrency,
  money,
  ownerContribution,
  ownerDraw,
  parseRate,
  rawTransaction,
  taxPayment,
  transfer,
  type RateSnapshot,
  type TransactionDraft,
} from '@ie-ledger/domain';
import { HttpProblem } from '../../problem';
import { isBankAccount } from '../dto';

type Body = CreateTransactionRequest;

const invalid = (path: string, message: string) =>
  new HttpProblem(422, 'validation_failed', message, [{ path: `body/${path}`, message }]);

/** Active accounts of the org by id, plus its system accounts. */
export class LedgerAccounts {
  private readonly byId: Map<string, AccountRow>;
  constructor(rows: readonly AccountRow[]) {
    this.byId = new Map(rows.filter((a) => a.archivedAt === null).map((a) => [a.id, a]));
  }

  get(id: string, path: string): AccountRow {
    const account = this.byId.get(id);
    if (!account) throw invalid(path, 'Account not found.');
    return account;
  }

  bank(id: string, path: string): AccountRow & { currency: string } {
    const account = this.get(id, path);
    if (!isBankAccount(account)) throw invalid(path, 'Pick a bank account.');
    return account;
  }

  ofKind(id: string, path: string, kind: AccountRow['kind'], label: string): AccountRow {
    const account = this.get(id, path);
    if (account.kind !== kind || account.systemKey !== null) throw invalid(path, `Pick ${label}.`);
    return account;
  }

  system(key: NonNullable<AccountRow['systemKey']>): AccountRow {
    for (const a of this.byId.values()) if (a.systemKey === key) return a;
    throw new HttpProblem(409, 'conflict', `The ${key} system account is missing or archived.`);
  }

  all(): Iterable<AccountRow> {
    return this.byId.values();
  }
}

/** Foreign currencies whose NBG rate on `occurredOn` the transaction needs. */
export function currenciesNeeded(body: Body, accounts: LedgerAccounts): string[] {
  const currencies = new Set<string>();
  switch (body.type) {
    case 'income':
    case 'expense':
    case 'owner_draw':
    case 'owner_contribution':
    case 'tax_payment':
      currencies.add(accounts.bank(body.bankAccountId, 'bankAccountId').currency);
      break;
    case 'transfer':
    case 'fx_conversion':
      currencies.add(accounts.bank(body.fromAccountId, 'fromAccountId').currency);
      currencies.add(accounts.bank(body.toAccountId, 'toAccountId').currency);
      break;
    case 'postings':
      for (const [i, p] of body.postings.entries()) {
        if (!isSupportedCurrency(p.currency)) {
          throw invalid(`postings/${i}/currency`, `${p.currency} is not supported.`);
        }
        currencies.add(p.currency);
      }
      break;
  }
  currencies.delete(BASE_CURRENCY);
  return [...currencies];
}

function snapshot(row: ExchangeRateRow): RateSnapshot {
  return {
    id: row.id,
    rateScaled: parseRate(row.rate),
    quantity: row.quantity,
    currency: row.currency,
  };
}

/** Builds the draft with the domain builder for the event. Rates are keyed by currency. */
export function buildManualDraft(
  body: Body,
  accounts: LedgerAccounts,
  rates: ReadonlyMap<string, ExchangeRateRow>,
): TransactionDraft {
  const rateOf = (currency: string): RateSnapshot | null => {
    if (currency === BASE_CURRENCY) return null;
    const row = rates.get(currency);
    if (!row) throw new Error(`rate for ${currency} not resolved`);
    return snapshot(row);
  };
  const common = { occurredOn: body.occurredOn, description: body.description };

  try {
    switch (body.type) {
      case 'income': {
        const bank = accounts.bank(body.bankAccountId, 'bankAccountId');
        const income = accounts.ofKind(
          body.incomeAccountId,
          'incomeAccountId',
          'income',
          'an income account',
        );
        return incomeReceipt({
          ...common,
          bankAccountId: bank.id,
          incomeAccountId: income.id,
          amount: money(body.amountMinor, bank.currency),
          rate: rateOf(bank.currency),
          paymentMethod: body.paymentMethod,
        });
      }
      case 'expense': {
        const bank = accounts.bank(body.bankAccountId, 'bankAccountId');
        const target = accounts.ofKind(
          body.expenseAccountId,
          'expenseAccountId',
          'expense',
          'an expense account',
        );
        return expense({
          ...common,
          bankAccountId: bank.id,
          expenseAccountId: target.id,
          amount: money(body.amountMinor, bank.currency),
          rate: rateOf(bank.currency),
        });
      }
      case 'owner_draw':
      case 'owner_contribution': {
        const bank = accounts.bank(body.bankAccountId, 'bankAccountId');
        const build = body.type === 'owner_draw' ? ownerDraw : ownerContribution;
        return build({
          ...common,
          bankAccountId: bank.id,
          equityAccountId: accounts.system('owner_equity').id,
          amount: money(body.amountMinor, bank.currency),
          rate: rateOf(bank.currency),
        });
      }
      case 'transfer': {
        const from = accounts.bank(body.fromAccountId, 'fromAccountId');
        const to = accounts.bank(body.toAccountId, 'toAccountId');
        if (from.id === to.id) throw invalid('toAccountId', 'Pick two different accounts.');
        if (from.currency !== to.currency) {
          throw invalid(
            'toAccountId',
            'The accounts are in different currencies: record a currency exchange instead.',
          );
        }
        return transfer({
          ...common,
          fromAccountId: from.id,
          toAccountId: to.id,
          amount: money(body.amountMinor, from.currency),
          rate: rateOf(from.currency),
        });
      }
      case 'fx_conversion': {
        const from = accounts.bank(body.fromAccountId, 'fromAccountId');
        const to = accounts.bank(body.toAccountId, 'toAccountId');
        if (from.currency === to.currency) {
          throw invalid(
            'toAccountId',
            'Both accounts are in the same currency: record a transfer instead.',
          );
        }
        return fxConversion({
          ...common,
          fromAccountId: from.id,
          toAccountId: to.id,
          fxClearingAccountId: accounts.system('fx_clearing').id,
          sold: money(body.soldAmountMinor, from.currency),
          bought: money(body.boughtAmountMinor, to.currency),
          soldRate: rateOf(from.currency),
          boughtRate: rateOf(to.currency),
        });
      }
      case 'tax_payment': {
        const bank = accounts.bank(body.bankAccountId, 'bankAccountId');
        if (bank.currency !== BASE_CURRENCY) {
          throw invalid('bankAccountId', 'The tax is paid in GEL: pick a GEL account.');
        }
        return taxPayment({
          ...common,
          taxPayableAccountId: accounts.system('tax_payable').id,
          bankAccountId: bank.id,
          amount: money(body.amountMinor, BASE_CURRENCY),
        });
      }
      case 'postings': {
        const postings = body.postings.map((p, i) => {
          const account = accounts.get(p.accountId, `postings/${i}/accountId`);
          if (account.currency !== null && account.currency !== p.currency) {
            throw invalid(
              `postings/${i}/currency`,
              `${account.name} is in ${account.currency}, not ${p.currency}.`,
            );
          }
          return { accountId: account.id, amount: money(p.amountMinor, p.currency) };
        });
        const sbs = postings.some(
          (p) => accounts.get(p.accountId, 'postings').incomeClass === 'sbs',
        );
        if (sbs && body.paymentMethod === null) {
          throw invalid(
            'paymentMethod',
            'A posting is on small-business income: choose the payment method (lines 18–21).',
          );
        }
        const rateMap = new Map<string, RateSnapshot>();
        for (const [currency, row] of rates) rateMap.set(currency, snapshot(row));
        return rawTransaction({
          ...common,
          postings,
          rates: rateMap,
          paymentMethod: body.paymentMethod,
        });
      }
    }
  } catch (err) {
    // Builder checks (positive amounts, balance per currency, distinct accounts) → 422.
    if (err instanceof DomainError) throw new HttpProblem(422, 'validation_failed', err.message);
    throw err;
  }
}

/** The draft as `POST /transactions/preview` shows it. */
export function toPreview(
  draft: TransactionDraft,
  accounts: LedgerAccounts,
  rates: ReadonlyMap<string, ExchangeRateRow>,
): TransactionPreview {
  return {
    occurredOn: draft.occurredOn,
    description: draft.description,
    paymentMethod: draft.paymentMethod,
    postings: draft.postings.map((p) => {
      const account = accounts.get(p.accountId, 'accountId');
      const rate = p.rateId === null ? undefined : rates.get(p.currency);
      return {
        accountId: p.accountId,
        amountMinor: p.amountMinor,
        currency: p.currency,
        gelAmountMinor: p.gelAmountMinor,
        rateId: p.rateId,
        account: {
          name: account.name,
          kind: account.kind,
          systemKey: account.systemKey,
          incomeClass: account.incomeClass,
        },
        rate: rate
          ? {
              rate: formatRate(parseRate(rate.rate)),
              quantity: rate.quantity,
              validFrom: rate.validFrom,
            }
          : null,
      };
    }),
  };
}
