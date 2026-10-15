// Budget from the WS-03 brief: 10k rows parse in under 1 s on CI. Inputs are generated here; no
// large files are committed.

import { describe, expect, it } from 'vitest';
import { bogCsv } from './bog/csv';
import { bogXlsx } from './bog/xlsx';
import { genericCsv } from './generic/csv';
import type { BogTestRow } from './test/build-xlsx';
import { buildBogXlsx } from './test/build-xlsx';

const ROWS = 10_000;
const BUDGET_MS = 1_000;

function cents(n: number): string {
  return `${Math.trunc(n / 100)}.${String(n % 100).padStart(2, '0')}`;
}

function time(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe(`performance: ${ROWS} rows < ${BUDGET_MS} ms`, () => {
  it('bog-csv', () => {
    const lines = [
      ',,,"angariSis #:GE00BG0000000000000001GBP (1)",,,,',
      ',,,"periodi: 01.01.25-31.12.25",,,,',
      '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
      '"01.01.2025","sawyisi naSTi",,"GBP",0.00,3.6,0.00,',
    ];
    let balance = 0;
    for (let i = 0; i < ROWS; i++) {
      const amount = 1000 + (i % 5000);
      balance += amount;
      const day = String(1 + (i % 28)).padStart(2, '0');
      lines.push(
        `"${day}.03.2025","PMI${i}","0F1E2D3C4B5A6978",,${cents(amount)},3.6924,${cents(amount * 3)},"CLIENT ${i}: \r\n\t  Incoming Transfer - Amount: GBP${cents(amount)}; Sender: CLIENT ${i}\\ADDR; Account: X; Bank: Y; Details: Z"`,
      );
      if (i % 10 === 9)
        lines.push(
          `"brunva",,,0,${cents(amount)},3.6924,,`,
          `"naSTi",,,,${cents(balance)},3.6924,,`,
        );
    }
    lines.push(`"31.12.25","saboloo naSTi",,"GBP",${cents(balance)},3.69,0,`);
    const bytes = new TextEncoder().encode(lines.join('\n'));
    let rows = 0;
    const ms = time(() => {
      const r = bogCsv.parse(bytes, { accountCurrency: 'GBP' });
      rows = r.rows.length;
      expect(r.warnings).toEqual([]);
    });
    expect(rows).toBe(ROWS);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('bog-xlsx', () => {
    const rows: BogTestRow[] = [];
    let balance = 0;
    for (let i = 0; i < ROWS; i++) {
      const amount = 1000 + (i % 5000);
      balance += amount;
      rows.push({
        serial: String(45658 + (i % 300)),
        doc: `PMI${i}`,
        loro: '0F1E2D3C4B5A6978',
        amount: cents(amount),
        gel: cents(amount * 3),
        code: 'PMI',
        opId: String(90000000000 + i),
        sender: `CLIENT ${i}\\ADDRESS`,
        comment: `Incoming Transfer - Amount: GBP${cents(amount)}; Sender: CLIENT ${i}`,
        balance: cents(balance),
      });
    }
    const bytes = buildBogXlsx(rows, { opening: '0', closing: cents(balance) });
    let count = 0;
    const ms = time(() => {
      const r = bogXlsx.parse(bytes, { accountCurrency: 'GBP' });
      count = r.rows.length;
      expect(r.warnings.filter((w) => w.code !== 'date_outside_period')).toEqual([]);
    });
    expect(count).toBe(ROWS);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('generic-csv', () => {
    const lines = ['Date;Amount;Payee;Memo'];
    for (let i = 0; i < ROWS; i++)
      lines.push(
        `2025-03-${String(1 + (i % 28)).padStart(2, '0')};"-1.234,${String(i % 100).padStart(2, '0')}";Payee ${i};"Memo ${i}"`,
      );
    const bytes = new TextEncoder().encode(lines.join('\r\n'));
    let count = 0;
    const ms = time(() => {
      count = genericCsv.parse(bytes, {
        accountCurrency: 'GEL',
        mapping: {
          headerRow: 0,
          date: 'Date',
          dateFormat: 'YYYY-MM-DD',
          decimalSeparator: ',',
          amount: { kind: 'signed', column: 'Amount' },
        },
      }).rows.length;
    });
    expect(count).toBe(ROWS);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
