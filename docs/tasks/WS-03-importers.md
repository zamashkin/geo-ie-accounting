# WS-03 Statement parsers

**Phase 1.** Bank of Georgia fixtures are ready (`fixtures/statements/bog/`, read `FORMAT.md` first). TBC fixtures are still missing: build the BoG and generic parsers now, TBC when its files arrive.

## Owns
`packages/importers/**`, `fixtures/statements/**` (expected-output JSON only; do not alter source files)

## Consumes
`contracts` (`ParsedRow`, `ParseWarning`), `domain` (money parsing, dedupe normalisation).

## Deliver
- `StatementParser` interface from ARCHITECTURE §6.
- Parsers, in this order: `bog-xlsx` (preferred, has operation IDs), `bog-csv`, `generic-csv`, then `tbc-csv`/`tbc-xlsx` once fixtures exist. `ParsedRow` must carry `operationType`, `bankReference`, `bankGelAmount`, `counterAmount` (for conversions) and `counterpartyAccount`, as described in `bog/FORMAT.md`. Propose these `contracts` fields in your report if WS-00 didn't add them.
- Generic CSV (column mapping: date, amount or debit/credit pair, currency, counterparty, description, reference; date format; decimal separator).
- `detect()` picks the parser by headers/structure; `detectBest(file, name)` returns the top match with confidence.
- Handles: BoG's legacy Latin-transliterated Georgian headers, report-style subtotal rows, multi-line quoted fields, `\` SWIFT wraps, Excel serial dates, inline-string cells, BOM, `;` vs `,` delimiters, Georgian and English headers, thousands separators, negative amounts vs separate debit/credit columns, multi-currency statements, trailing summary rows.
- XLSX via a maintained library; parse in a way that works in the worker (Node) without native deps.

## Acceptance
- For every fixture, `parse()` output equals a committed `*.expected.json`.
- BoG CSV and XLSX of the same period produce the same 4 operations (same dates, signed amounts, types).
- Reconciliation: opening balance + Σ amounts = closing balance for each BoG fixture; a mismatch yields a warning.
- Fuzz/garbage input returns warnings and never throws.
- Parsing 10k rows < 1s on CI.
