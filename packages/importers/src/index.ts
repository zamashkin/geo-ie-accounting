// packages/importers: pure statement parsers. No I/O.
// WS-03 implements the parsers; the interface below is ARCHITECTURE §6.
import type { ParseOptions, ParseResult, ParserId } from '@ie-ledger/contracts';

export interface StatementParser {
  id: ParserId;
  /** Confidence 0..1 that this parser understands the file. */
  detect(file: Uint8Array, fileName: string): number;
  parse(file: Uint8Array, opts: ParseOptions): ParseResult;
}

export const parsers: readonly StatementParser[] = [];
