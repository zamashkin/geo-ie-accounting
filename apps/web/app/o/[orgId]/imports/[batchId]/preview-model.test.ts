import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import type { Schemas } from '@/lib/api/client';
import { applyRowPatch, blockedRowIds, bookableRows, rowAccountOptions } from './preview-model';

const row: Schemas['ImportRowView'] = {
  id: 'r1',
  batchId: 'b1',
  orgId: 'o1',
  rowIndex: 0,
  bookedOn: '2025-06-04',
  amountMinor: '118000',
  currency: 'GBP',
  counterparty: 'Example Client Ltd',
  counterpartyAccount: null,
  description: 'Incoming transfer',
  bankReference: null,
  documentNumber: 'PMI1',
  operationType: 'incoming_payment',
  bankGelAmountMinor: '435703',
  counterAmountMinor: null,
  counterCurrency: null,
  dedupeHash: 'h',
  status: 'new',
  suggestedAccountId: 'income',
  chosenAccountId: null,
  transactionId: null,
  accountId: 'income',
};

function account(id: string, over: Partial<Schemas['Account']> = {}): Schemas['Account'] {
  return {
    id,
    orgId: 'o1',
    name: id,
    kind: 'income',
    currency: null,
    systemKey: null,
    incomeClass: 'sbs',
    bank: null,
    iban: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('applyRowPatch', () => {
  it('books against the chosen account, and back to the suggestion on null', () => {
    const chosen = applyRowPatch(row, { accountId: 'fees' });
    expect(chosen).toMatchObject({ chosenAccountId: 'fees', accountId: 'fees' });
    expect(applyRowPatch(chosen, { accountId: null })).toMatchObject({
      chosenAccountId: null,
      accountId: 'income',
    });
  });

  it('skips and includes', () => {
    const skipped = applyRowPatch(row, { skip: true });
    expect(skipped.status).toBe('skipped');
    expect(bookableRows([row, skipped])).toEqual([row]);
    expect(applyRowPatch(skipped, { skip: false }).status).toBe('new');
  });
});

describe('blockedRowIds', () => {
  it('reads the row ids from a commit 422', () => {
    const err = new ApiError(
      {
        type: 'about:blank',
        title: 'Unprocessable Entity',
        status: 422,
        code: 'validation_failed',
        requestId: 'x',
        errors: [
          { path: 'rows/r1', message: 'No account chosen' },
          { path: 'name', message: 'other' },
        ],
      },
      'problem',
    );
    expect([...blockedRowIds(err)]).toEqual(['r1']);
  });
});

describe('rowAccountOptions', () => {
  it('offers active accounts in the row currency, never the bank account itself', () => {
    const options = rowAccountOptions(
      [
        account('income'),
        account('bank-gbp', { kind: 'asset', currency: 'GBP', incomeClass: null }),
        account('bank-usd', { kind: 'asset', currency: 'USD', incomeClass: null }),
        account('fx', { kind: 'asset', systemKey: 'fx_clearing', incomeClass: null }),
        account('old', { archivedAt: '2026-01-02T00:00:00.000Z' }),
      ],
      'bank-gbp',
      'GBP',
    );
    expect(options.map((o) => o.id)).toEqual(['income', 'fx']);
    expect(options[0]?.description).toBe('Small-business income (declared)');
  });
});
