import type { GenericCsvMapping } from '@ie-ledger/contracts';
import { describe, expect, it } from 'vitest';
import { genericCsv } from './csv';

const enc = (s: string) => new TextEncoder().encode(s);
const codes = (r: { warnings: { code: string }[] }) => r.warnings.map((w) => w.code);

const SIGNED: GenericCsvMapping = {
  headerRow: 0,
  date: 'Date',
  dateFormat: 'YYYY-MM-DD',
  decimalSeparator: '.',
  amount: { kind: 'signed', column: 'Amount' },
  counterparty: 'Payee',
  description: 'Memo',
  reference: 'Ref',
};

describe('generic-csv', () => {
  it('parses a signed-amount CSV with thousands separators and quoted fields', () => {
    const text =
      'Date,Amount,Payee,Memo,Ref\n2025-06-04,"1,180.00",ACME,"Invoice 7\nJune",R1\n2025-06-05,-690.85,,FX,\n';
    const r = genericCsv.parse(enc(text), { accountCurrency: 'GBP', mapping: SIGNED });
    expect(r.warnings).toEqual([]);
    expect(r.parserId).toBe('generic-csv');
    expect(r.rows).toEqual([
      {
        rowIndex: 0,
        bookedOn: '2025-06-04',
        amountMinor: 118000n,
        currency: 'GBP',
        counterparty: 'ACME',
        counterpartyAccount: null,
        description: 'Invoice 7 June',
        bankReference: 'R1',
        documentNumber: null,
        operationType: 'other',
        bankOperationCode: null,
        bankGelAmountMinor: null,
        counterAmountMinor: null,
        counterCurrency: null,
        raw: {
          Date: '2025-06-04',
          Amount: '1,180.00',
          Payee: 'ACME',
          Memo: 'Invoice 7\nJune',
          Ref: 'R1',
        },
      },
      expect.objectContaining({
        rowIndex: 1,
        amountMinor: -69085n,
        counterparty: null,
        bankReference: null,
      }),
    ]);
  });

  it('handles ; delimiters, comma decimals, debit/credit pairs, a BOM and a preamble', () => {
    const text =
      '﻿Account statement;;;\nExported 2025-07-01;;;\nDatum;Lastschrift;Gutschrift;Währung;Text\n' +
      '04.06.2025;;1.180,00;eur;Kunde\n05.06.2025;-690,85;;EUR;Gebühr\nSumme;690,85;1.180,00;;\n';
    const mapping: GenericCsvMapping = {
      headerRow: 2,
      date: 'datum',
      dateFormat: 'DD.MM.YYYY',
      decimalSeparator: ',',
      amount: { kind: 'debit_credit', debit: 'Lastschrift', credit: 'Gutschrift' },
      currency: 'Währung',
      description: 'Text',
    };
    const r = genericCsv.parse(enc(text), { accountCurrency: 'GEL', mapping });
    expect(r.rows.map((x) => [x.bookedOn, x.amountMinor, x.currency, x.description])).toEqual([
      ['2025-06-04', 118000n, 'EUR', 'Kunde'],
      ['2025-06-05', -69085n, 'EUR', 'Gebühr'],
    ]);
    // The trailing "Summe" row has no date: skipped with a warning.
    expect(codes(r)).toEqual(['unparseable_row']);
  });

  it('uses the account currency when the currency cell is unusable', () => {
    const text = 'Date,Amount,Ccy\n2025-01-01,5,??\n';
    const r = genericCsv.parse(enc(text), {
      accountCurrency: 'USD',
      mapping: {
        ...SIGNED,
        currency: 'Ccy',
        counterparty: undefined,
        description: undefined,
        reference: undefined,
      },
    });
    expect(r.rows[0]?.currency).toBe('USD');
    expect(codes(r)).toEqual(['invalid_currency']);
  });

  it('respects the currency exponent', () => {
    const text = 'Date,Amount,Ccy\n2025-01-01,1500,JPY\n2025-01-01,1.234,KWD\n';
    const mapping = {
      ...SIGNED,
      currency: 'Ccy',
      counterparty: undefined,
      description: undefined,
      reference: undefined,
    };
    const r = genericCsv.parse(enc(text), { accountCurrency: 'USD', mapping });
    expect(r.rows.map((x) => x.amountMinor)).toEqual([1500n, 1234n]);
  });

  it('warns on rounding, unreadable amounts and both-sided rows', () => {
    const mapping: GenericCsvMapping = {
      ...SIGNED,
      amount: { kind: 'debit_credit', debit: 'D', credit: 'C' },
    };
    const text = 'Date,D,C\n2025-01-01,,1.005\n2025-01-02,abc,\n2025-01-03,1,2\n';
    const r = genericCsv.parse(enc(text), {
      accountCurrency: 'USD',
      mapping: {
        ...mapping,
        counterparty: undefined,
        description: undefined,
        reference: undefined,
      },
    });
    expect(r.rows.map((x) => x.amountMinor)).toEqual([101n, 100n]);
    expect(codes(r)).toEqual(['amount_rounded', 'unparseable_row', 'ambiguous_debit_credit']);
  });

  it('needs a mapping and the mapped columns', () => {
    expect(codes(genericCsv.parse(enc('a,b\n1,2'), { accountCurrency: 'GEL' }))).toEqual([
      'mapping_required',
    ]);
    const r = genericCsv.parse(enc('Date,Value\n2025-01-01,1'), {
      accountCurrency: 'GEL',
      mapping: SIGNED,
    });
    expect(r.rows).toEqual([]);
    expect(codes(r)).toEqual(['missing_column']);
    expect(codes(genericCsv.parse(enc(''), { accountCurrency: 'GEL', mapping: SIGNED }))).toEqual([
      'header_not_found',
    ]);
  });

  it('ignores optional columns that are not in the file', () => {
    const r = genericCsv.parse(enc('Date,Amount\n2025-01-01,1'), {
      accountCurrency: 'GEL',
      mapping: SIGNED,
    });
    expect(r.rows).toHaveLength(1);
    expect(codes(r)).toEqual(['missing_column', 'missing_column', 'missing_column']);
  });

  it('decodes windows-1252 files', () => {
    const bytes = new Uint8Array([...enc('Date,Amount,Memo\n2025-01-01,1,caf'), 0xe9, 0x0a]);
    const r = genericCsv.parse(bytes, {
      accountCurrency: 'EUR',
      mapping: { ...SIGNED, counterparty: undefined, reference: undefined },
    });
    expect(r.rows[0]?.description).toBe('café');
    expect(codes(r)).toEqual(['encoding_fallback']);
  });
});
