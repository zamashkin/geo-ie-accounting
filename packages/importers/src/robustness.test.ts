// Garbage in, warnings out: no parser may throw, whatever the bytes.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { GenericCsvMapping, ParseOptions } from '@geo-ie-accounting/contracts';
import { ParseResult } from '@geo-ie-accounting/contracts';
import { describe, expect, it } from 'vitest';
import { bogXlsx } from './bog/xlsx';
import { parsers } from './registry';
import type { BogTestRow } from './test/build-xlsx';
import { buildBogXlsx } from './test/build-xlsx';

const FIXTURES = path.resolve(import.meta.dirname, '../../../fixtures/statements/bog');
const seeds = [
  new Uint8Array(readFileSync(path.join(FIXTURES, 'bog-gbp-2025-06.csv'))),
  new Uint8Array(readFileSync(path.join(FIXTURES, 'bog-gbp-2025-06.xlsx'))),
];

const MAPPING: GenericCsvMapping = {
  headerRow: 0,
  date: 'TariRi',
  dateFormat: 'DD.MM.YYYY',
  decimalSeparator: '.',
  amount: { kind: 'debit_credit', debit: 'debeti', credit: 'krediti' },
};
const OPTS: ParseOptions = { accountCurrency: 'GBP', mapping: MAPPING };

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mutate(bytes: Uint8Array, rand: () => number): Uint8Array {
  const out = bytes.slice();
  const ops = 1 + Math.floor(rand() * 8);
  for (let i = 0; i < ops; i++) {
    const at = Math.floor(rand() * out.length);
    const kind = rand();
    if (kind < 0.5) out[at] = Math.floor(rand() * 256);
    else if (kind < 0.7)
      out[at] = [0x22, 0x2c, 0x0a, 0x0d, 0x5c, 0x3c][Math.floor(rand() * 6)] ?? 0;
    else return out.subarray(0, at); // truncate
  }
  return out;
}

function assertValid(result: ParseResult) {
  // Must be valid contract output, i.e. serialisable for the job queue.
  expect(() => ParseResult.encode(result)).not.toThrow();
  // `internal_error` means an exception was caught by the safety net: that is a bug.
  expect(result.warnings.map((w) => w.code)).not.toContain('internal_error');
}

describe('robustness', () => {
  const garbage: [string, Uint8Array][] = [
    ['empty', new Uint8Array(0)],
    ['one byte', new Uint8Array([0x22])],
    ['zip magic only', new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
    ['random', Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251)],
    ['html', new TextEncoder().encode('<html><body>Session expired</body></html>')],
    ['unterminated quote', new TextEncoder().encode('"TariRi","debeti","krediti"\n"01.01.2025,1')],
    ['truncated xlsx', seeds[1]!.subarray(0, 4000)],
  ];

  it.each(garbage)('%s: every parser returns warnings, never throws', (_, bytes) => {
    for (const p of parsers) {
      expect(() => p.detect(bytes, 'x')).not.toThrow();
      const r = p.parse(bytes, OPTS);
      assertValid(r);
      expect(r.rows.length === 0 ? r.warnings.length : 1).toBeGreaterThan(0);
    }
  });

  it('survives 300 random mutations of each fixture', () => {
    const rand = rng(20250604);
    for (const seed of seeds) {
      for (let i = 0; i < 300; i++) {
        const bytes = mutate(seed, rand);
        for (const p of parsers) {
          const confidence = p.detect(bytes, 'statement');
          expect(confidence).toBeGreaterThanOrEqual(0);
          expect(confidence).toBeLessThanOrEqual(1);
          assertValid(p.parse(bytes, OPTS));
        }
      }
    }
  });

  it('survives garbage cell values inside a well-formed BoG workbook', () => {
    const rand = rng(45812);
    const junk = [
      '',
      ' ',
      '-',
      '1e400',
      'NaN',
      '0x10',
      '1,2,3',
      '99999999999999999999.999',
      '45812.5',
      '31.02.2025',
      '\\\\',
      'PMI',
      '&amp;',
      '"',
      '-0',
      '(5)',
    ];
    const pick = () => junk[Math.floor(rand() * junk.length)] ?? '';
    for (let i = 0; i < 200; i++) {
      const row: BogTestRow = {
        serial: pick(),
        doc: pick(),
        loro: pick(),
        amount: pick(),
        gel: pick(),
        code: pick(),
        opId: pick(),
        sender: pick(),
        recipient: pick(),
        comment: pick(),
        destAmount: pick(),
        destCcy: pick(),
        balance: pick(),
      };
      const r = bogXlsx.parse(
        buildBogXlsx([row], { opening: pick(), closing: pick(), currency: pick() }),
        OPTS,
      );
      assertValid(r);
    }
  });
});
