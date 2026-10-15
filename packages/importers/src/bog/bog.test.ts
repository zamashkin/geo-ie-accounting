import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BogTestRow } from '../test/build-xlsx';
import { BOG_XLSX_HEADERS, buildBogXlsx, buildXlsx } from '../test/build-xlsx';
import { parseAccountField, parsePeriod } from './common';
import { bogCsv } from './csv';
import { bogXlsx } from './xlsx';

const FIXTURE = path.resolve(
  import.meta.dirname,
  '../../../../fixtures/statements/bog/bog-gbp-2025-06',
);
const csvText = readFileSync(`${FIXTURE}.csv`, 'latin1');
const enc = (s: string) => new TextEncoder().encode(s);
const codes = (r: { warnings: { code: string }[] }) => r.warnings.map((w) => w.code);

const PMI: BogTestRow = {
  serial: '45812',
  doc: 'PMI1',
  loro: 'ACC1',
  amount: '100.00',
  gel: '369.24',
  code: 'PMI',
  opId: '1',
  sender: 'CLIENT LTD\\ADDRESS',
  balance: '100.00',
};

describe('bog-csv', () => {
  it('warns when opening + Σ amounts ≠ closing (a transaction line removed)', () => {
    const lines = csvText.split('\n');
    const cut = lines.findIndex((l) => l.startsWith('"11.06.2025"'));
    // The 11.06 transaction spans two physical lines (quoted multi-line description).
    const edited = [...lines.slice(0, cut), ...lines.slice(cut + 2)].join('\n');
    const r = bogCsv.parse(enc(edited), { accountCurrency: 'GBP' });
    expect(r.rows).toHaveLength(3);
    expect(codes(r)).toContain('reconciliation_mismatch');
    expect(codes(r)).toContain('turnover_mismatch');
  });

  it('matches headers case-sensitively (legacy transliteration: T and t are different letters)', () => {
    const r = bogCsv.parse(enc(csvText.replace('"TariRi"', '"tariri"')), {
      accountCurrency: 'GBP',
    });
    expect(r.rows).toEqual([]);
    expect(codes(r)).toEqual(['header_not_found']);
  });

  it('skips rows with a bad date and says which line', () => {
    const r = bogCsv.parse(enc(csvText.replace('"04.06.2025"', '"31.02.2025"')), {
      accountCurrency: 'GBP',
    });
    expect(r.rows).toHaveLength(3);
    expect(r.warnings.find((w) => w.code === 'unparseable_row')?.message).toMatch(/^Line \d+ /);
    expect(codes(r)).toContain('reconciliation_mismatch');
  });

  it('marks an operation it cannot classify as other, with a warning', () => {
    const text = [
      ',,,"angariSis #:GE00BG0000000000000001GEL (1)",,,,',
      '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
      '"01.07.2025","sawyisi naSTi",,"GEL",100.00,1,100.00,',
      '"02.07.2025","777","GE11TB0000000000000002",25.50,,1,25.50,"Utility bill"',
      '"02.07.2025","saboloo naSTi",,"GEL",74.50,1,74.50,',
    ].join('\r\n');
    const r = bogCsv.parse(enc(text), { accountCurrency: 'GEL' });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      amountMinor: -2550n,
      operationType: 'other',
      bankGelAmountMinor: -2550n,
      counterparty: null,
    });
    expect(codes(r)).toEqual(['unknown_operation_type']);
  });

  it('recognises a conversion by our own IBAN with another currency suffix', () => {
    const text = [
      ',,,"angariSis #:GE00BG0000000000000001GEL (1)",,,,',
      '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
      '"02.07.2025","9","GE00BG0000000000000001USD",,270.00,1,270.00,"Something new"',
    ].join('\n');
    const r = bogCsv.parse(enc(text), { accountCurrency: 'GEL' });
    expect(r.rows[0]?.operationType).toBe('fx_conversion');
    expect(codes(r)).toEqual(['reconciliation_unavailable']);
  });

  it('warns when the statement currency differs from the account', () => {
    const r = bogCsv.parse(enc(csvText), { accountCurrency: 'USD' });
    expect(r.meta.currency).toBe('GBP');
    expect(r.rows[0]?.currency).toBe('GBP');
    expect(codes(r)).toEqual(['currency_mismatch']);
  });

  it('flags a row with both debit and credit', () => {
    const r = bogCsv.parse(
      enc(
        csvText.replace(
          '"PMI100000002","0F1E2D3C4B5A69788796A5B4C3D2E1F0",,',
          '"PMI100000002","0F1E2D3C4B5A69788796A5B4C3D2E1F0",1.00,',
        ),
      ),
      {
        accountCurrency: 'GBP',
      },
    );
    expect(codes(r)).toContain('ambiguous_debit_credit');
    expect(r.rows[3]?.amountMinor).toBe(36300n);
  });
});

describe('bog-xlsx', () => {
  const opts = { accountCurrency: 'GBP' };

  it('reads a minimal BoG workbook built in memory (shared-string headers)', () => {
    const file = buildBogXlsx([PMI], { opening: '0', closing: '100.00' }, { sharedStrings: true });
    const r = bogXlsx.parse(file, opts);
    expect(r.warnings).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      bookedOn: '2025-06-04',
      amountMinor: 10000n,
      counterparty: 'CLIENT LTD',
      bankGelAmountMinor: 36924n,
      bankReference: '1',
      operationType: 'incoming_payment',
    });
  });

  it('uses the recipient as counterparty for money going out', () => {
    const out: BogTestRow = {
      ...PMI,
      amount: '-10.00',
      gel: '-36.92',
      code: 'TRF',
      recipient: 'SUPPLIER LLC\\TBILISI',
      sender: 'ME',
    };
    const r = bogXlsx.parse(buildBogXlsx([out]), opts);
    expect(r.rows[0]).toMatchObject({
      counterparty: 'SUPPLIER LLC',
      operationType: 'other',
      amountMinor: -1000n,
    });
    expect(codes(r)).toContain('unknown_operation_type');
  });

  it('warns on reconciliation and running-balance mismatches', () => {
    const r = bogXlsx.parse(
      buildBogXlsx([{ ...PMI, balance: '99.00' }], { opening: '0', closing: '99.00' }),
      opts,
    );
    expect(codes(r)).toEqual(['running_balance_mismatch', 'reconciliation_mismatch']);
  });

  it('warns when Amount and Debit/Credit disagree, and trusts Amount', () => {
    const header = BOG_XLSX_HEADERS;
    const row = header.map((h) => {
      if (h === 'Date') return { n: '45812' };
      if (h === ' Credit') return { n: '90.00' };
      if (h === 'Amount') return { n: '100.00' };
      if (h === 'Operation Type') return 'PMI';
      return null;
    });
    const r = bogXlsx.parse(buildXlsx([[null, 'Currency: ', 'GBP'], header, row]), opts);
    expect(r.rows[0]?.amountMinor).toBe(10000n);
    expect(codes(r)).toContain('amount_mismatch');
  });

  it('reads the counter-amount of a conversion from Destination columns, else from the text', () => {
    const cco: BogTestRow = {
      ...PMI,
      amount: '-690.85',
      gel: '-2552.55',
      code: 'CCO',
      destAmount: '900',
      destCcy: 'USD',
    };
    expect(bogXlsx.parse(buildBogXlsx([cco]), opts).rows[0]).toMatchObject({
      counterAmountMinor: 90000n,
      counterCurrency: 'USD',
      counterparty: null,
    });
    const { destAmount: _a, destCcy: _c, ...withoutDest } = cco;
    const noDest: BogTestRow = {
      ...withoutDest,
      comment: 'Counter-amount: GEL1,785.83. Currency Exchange',
    };
    expect(bogXlsx.parse(buildBogXlsx([noDest]), opts).rows[0]).toMatchObject({
      counterAmountMinor: 178583n,
      counterCurrency: 'GEL',
    });
  });

  it('flags an incoming payment that takes money out', () => {
    const r = bogXlsx.parse(buildBogXlsx([{ ...PMI, amount: '-1.00', gel: '-3.69' }]), opts);
    expect(codes(r)).toContain('unexpected_direction');
  });

  it('skips undated rows with a warning that names the sheet row', () => {
    const header = BOG_XLSX_HEADERS;
    const row = header.map((h) => (h === 'Amount' ? { n: '1.00' } : h === 'Date' ? 'TOTAL' : null));
    const r = bogXlsx.parse(buildXlsx([header, row]), opts);
    expect(r.rows).toEqual([]);
    expect(r.warnings.find((w) => w.code === 'unparseable_row')?.message).toMatch(/^Sheet row 2 /);
  });

  it('reports missing columns and an unknown layout', () => {
    expect(codes(bogXlsx.parse(buildXlsx([['Date', 'Something']]), opts))).toEqual([
      'header_not_found',
    ]);
    const r = bogXlsx.parse(buildXlsx([['Date', 'Debit']]), opts);
    expect(r.warnings.map((w) => w.code)).toContain('missing_column');
  });

  it('reads dates written as text', () => {
    const header = BOG_XLSX_HEADERS;
    const row = header.map((h) =>
      h === 'Date'
        ? '04.06.2025'
        : h === 'Amount'
          ? { n: '1' }
          : h === 'Operation Type'
            ? 'PMI'
            : null,
    );
    expect(bogXlsx.parse(buildXlsx([header, row]), opts).rows[0]?.bookedOn).toBe('2025-06-04');
  });
});

describe('BoG header fields', () => {
  it.each([
    ['GE59BG0000000123456789GBP (123456789)', 'GE59BG0000000123456789', 'GBP'],
    ['GE59BG0000000123456789USD', 'GE59BG0000000123456789', 'USD'],
    ['GE59BG0000000123456789', 'GE59BG0000000123456789', null],
    ['0F1E2D3C4B5A69788796A5B4C3D2E1F0', null, null],
    ['', null, null],
  ])('account %j', (input, iban, ccy) => {
    expect(parseAccountField(input)).toEqual({ iban, currency: ccy });
  });

  it('periods with 4- and 2-digit years', () => {
    expect(parsePeriod('15.05.2025-15.06.2025')).toEqual({ from: '2025-05-15', to: '2025-06-15' });
    expect(parsePeriod(' 15.05.25-15.06.25')).toEqual({ from: '2025-05-15', to: '2025-06-15' });
    expect(parsePeriod('garbage')).toEqual({ from: null, to: null });
  });
});
