import type {
  ParseOptions,
  ParseResult,
  ParserId,
  StatementMeta,
} from '@geo-ie-accounting/contracts';
import { Warnings } from './warnings';

/** ARCHITECTURE §6. Implementations are pure: bytes in, result out, never throw. */
export interface StatementParser {
  id: ParserId;
  /** Confidence 0..1 that this parser understands the file. Never throws. */
  detect(file: Uint8Array, fileName: string): number;
  /** Never throws: anything wrong with the file becomes a warning. */
  parse(file: Uint8Array, opts: ParseOptions): ParseResult;
}

export const EMPTY_META: StatementMeta = {
  accountIban: null,
  currency: null,
  periodFrom: null,
  periodTo: null,
  openingBalanceMinor: null,
  closingBalanceMinor: null,
};

/**
 * Wraps a parse implementation so that a bug (an exception) still yields a ParseResult with an
 * `internal_error` warning instead of crashing the import job.
 */
export function safeParse(
  id: ParserId,
  impl: (
    file: Uint8Array,
    opts: ParseOptions,
    warnings: Warnings,
  ) => Omit<ParseResult, 'parserId' | 'warnings'>,
): (file: Uint8Array, opts: ParseOptions) => ParseResult {
  return (file, opts) => {
    const warnings = new Warnings();
    try {
      const { meta, rows } = impl(file, opts, warnings);
      return { parserId: id, meta, rows, warnings: warnings.list };
    } catch (e) {
      const kind = e instanceof Error ? e.name : typeof e;
      warnings.add(
        'internal_error',
        `The parser failed unexpectedly (${kind}). No rows were read.`,
      );
      return { parserId: id, meta: EMPTY_META, rows: [], warnings: warnings.list };
    }
  };
}

/** Same as safeParse for detect(): any exception means "not mine". */
export function safeDetect(
  impl: (file: Uint8Array, fileName: string) => number,
): (file: Uint8Array, fileName: string) => number {
  return (file, fileName) => {
    try {
      const c = impl(file, fileName);
      return Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
    } catch {
      return 0;
    }
  };
}
