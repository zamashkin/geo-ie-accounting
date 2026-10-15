// Every committed fixture must parse to its reviewed `*.expected.json`.
//
// To regenerate after an intentional change: UPDATE_EXPECTED=1 pnpm --filter @ie-ledger/importers test
// then review the diff line by line against the source file. Never accept a snapshot blindly.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParseOptions } from '@ie-ledger/contracts';
import { ParseResult } from '@ie-ledger/contracts';
import { describe, expect, it } from 'vitest';
import type { StatementParser } from '../parser';
import { detectBest } from '../registry';
import { bogCsv } from './csv';
import { bogXlsx } from './xlsx';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../fixtures/statements');

const CASES: { file: string; parser: StatementParser; opts: ParseOptions }[] = [
  { file: 'bog/bog-gbp-2025-06.xlsx', parser: bogXlsx, opts: { accountCurrency: 'GBP' } },
  { file: 'bog/bog-gbp-2025-06.csv', parser: bogCsv, opts: { accountCurrency: 'GBP' } },
];

function load(file: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, file)));
}

describe.each(CASES)('$file', ({ file, parser, opts }) => {
  const result = parser.parse(load(file), opts);

  it('matches the reviewed expected output', () => {
    const encoded = ParseResult.encode(result);
    const expectedPath = path.join(FIXTURES, `${file}.expected.json`);
    if (process.env['UPDATE_EXPECTED'] === '1') {
      writeFileSync(expectedPath, `${JSON.stringify(encoded, null, 2)}\n`);
    }
    const expected: unknown = JSON.parse(readFileSync(expectedPath, 'utf8'));
    expect(encoded).toEqual(expected);
    // The expected file is also valid contract output.
    expect(ParseResult.parse(expected)).toEqual(result);
  });

  it('is detected as its own format', () => {
    const best = detectBest(load(file), path.basename(file));
    expect(best?.parserId).toBe(parser.id);
    expect(best?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('reconciles: opening + Σ amounts = closing, with no warnings', () => {
    const { openingBalanceMinor, closingBalanceMinor } = result.meta;
    const sum = result.rows.reduce((s, r) => s + r.amountMinor, 0n);
    expect(openingBalanceMinor).toBe(4n);
    expect(closingBalanceMinor).toBe(36419n);
    expect(openingBalanceMinor! + sum).toBe(closingBalanceMinor);
    expect(result.warnings).toEqual([]);
  });
});

describe('BoG CSV and XLSX of the same period', () => {
  const xlsx = bogXlsx.parse(load('bog/bog-gbp-2025-06.xlsx'), { accountCurrency: 'GBP' });
  const csv = bogCsv.parse(load('bog/bog-gbp-2025-06.csv'), { accountCurrency: 'GBP' });

  it('produce the same 4 operations', () => {
    const key = (r: (typeof xlsx.rows)[number]) => ({
      bookedOn: r.bookedOn,
      amountMinor: r.amountMinor,
      currency: r.currency,
      operationType: r.operationType,
      documentNumber: r.documentNumber,
      counterparty: r.counterparty,
      counterpartyAccount: r.counterpartyAccount,
      bankGelAmountMinor: r.bankGelAmountMinor,
      counterAmountMinor: r.counterAmountMinor,
      counterCurrency: r.counterCurrency,
    });
    expect(xlsx.rows).toHaveLength(4);
    expect(csv.rows.map(key)).toEqual(xlsx.rows.map(key));
    expect(xlsx.rows.map((r) => [r.bookedOn, r.amountMinor, r.operationType])).toEqual([
      ['2025-06-04', 118000n, 'incoming_payment'],
      ['2025-06-05', -69085n, 'fx_conversion'],
      ['2025-06-05', -48900n, 'fx_conversion'],
      ['2025-06-11', 36400n, 'incoming_payment'],
    ]);
  });

  it('agree on the statement header', () => {
    expect(csv.meta).toEqual(xlsx.meta);
  });

  it('only XLSX carries the stable operation ID', () => {
    expect(xlsx.rows.map((r) => r.bankReference)).toEqual([
      '90000000001',
      '90000000002',
      '90000000003',
      '90000000004',
    ]);
    expect(csv.rows.every((r) => r.bankReference === null)).toBe(true);
  });
});
