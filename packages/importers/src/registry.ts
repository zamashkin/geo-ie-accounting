import type { ParserId } from '@geo-ie-accounting/contracts';
import { bogCsv } from './bog/csv';
import { bogXlsx } from './bog/xlsx';
import { genericCsv } from './generic/csv';
import type { StatementParser } from './parser';

/**
 * Every parser, most specific first. Ties in `detectBest` go to the earlier entry.
 *
 * TODO(WS-03, TBC): add `tbc-xlsx` and `tbc-csv` here (before `generic-csv`) once real TBC exports
 * are in `fixtures/statements/tbc/` (docs/tasks/README.md "Inputs needed"). Their ids already
 * exist in contracts `PARSER_IDS`. Do not write them against guessed formats.
 */
export const parsers: readonly StatementParser[] = [bogXlsx, bogCsv, genericCsv];

export function parserById(id: ParserId): StatementParser | undefined {
  return parsers.find((p) => p.id === id);
}

export interface Detection {
  parser: StatementParser;
  parserId: ParserId;
  /** 0..1 */
  confidence: number;
}

/** Every parser's confidence for the file, highest first. Parsers that answer 0 are left out. */
export function detect(file: Uint8Array, fileName: string): Detection[] {
  return parsers
    .map((parser) => ({ parser, parserId: parser.id, confidence: parser.detect(file, fileName) }))
    .filter((d) => d.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}

/** Below this, a match is a guess: the UI should ask the user to pick a format. */
export const MIN_CONFIDENCE = 0.5;

/** The best parser for the file, or null if no parser recognises it at all. */
export function detectBest(file: Uint8Array, fileName: string): Detection | null {
  return detect(file, fileName)[0] ?? null;
}
