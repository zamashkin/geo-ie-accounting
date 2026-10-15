// packages/importers: pure statement parsers, (file bytes, options) -> ParseResult. No I/O.
// Parser contract: ARCHITECTURE §6. Formats: fixtures/statements/<bank>/FORMAT.md.

export type { StatementParser } from './parser';
export { parsers, parserById, detect, detectBest, MIN_CONFIDENCE } from './registry';
export type { Detection } from './registry';
export { bogXlsx } from './bog/xlsx';
export { bogCsv } from './bog/csv';
export { genericCsv } from './generic/csv';
export { WARNING_CODES } from './warnings';
export type { WarningCode } from './warnings';
