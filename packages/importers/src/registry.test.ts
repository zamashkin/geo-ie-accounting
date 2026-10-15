import { PARSER_IDS, StatementDetection } from '@ie-ledger/contracts';
import { describe, expect, it } from 'vitest';
import { buildXlsx } from './test/build-xlsx';
import { detect, detectBest, MIN_CONFIDENCE, parserById, parsers } from './registry';

const enc = (s: string) => new TextEncoder().encode(s);

describe('registry', () => {
  it('registers BoG and generic parsers with ids from contracts (TBC pending fixtures)', () => {
    expect(parsers.map((p) => p.id)).toEqual(['bog-xlsx', 'bog-csv', 'generic-csv']);
    for (const p of parsers) expect(PARSER_IDS).toContain(p.id);
    expect(parserById('bog-csv')?.id).toBe('bog-csv');
    expect(parserById('tbc-csv')).toBeUndefined();
  });

  it('falls back to generic-csv for an unknown table, below the confidence bar', () => {
    const best = detectBest(enc('date;amount\n2025-01-01;1,00\n'), 'export.csv');
    expect(best?.parserId).toBe('generic-csv');
    expect(
      StatementDetection.parse({ parserId: best?.parserId, confidence: best?.confidence }),
    ).toEqual({
      parserId: 'generic-csv',
      confidence: 0.3,
    });
    expect(best!.confidence).toBeLessThan(MIN_CONFIDENCE);
  });

  it('recognises nothing in random bytes, an empty file or a foreign workbook', () => {
    expect(detectBest(new Uint8Array(0), 'x.csv')).toBeNull();
    expect(detectBest(new Uint8Array([0, 1, 2, 3, 255, 0]), 'x.bin')).toBeNull();
    expect(detectBest(enc('just one line'), 'x.txt')).toBeNull();
    const other = detect(
      buildXlsx([
        ['Name', 'Age'],
        ['a', { n: '1' }],
      ]),
      'people.xlsx',
    );
    expect(other.every((d) => d.confidence < MIN_CONFIDENCE)).toBe(true);
  });

  it('a BoG CSV header without the metadata block still wins over generic', () => {
    const text =
      '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti"\n"01.01.2025","1","x",1,\n';
    expect(detectBest(enc(text), 'statement.csv')?.parserId).toBe('bog-csv');
  });
});
