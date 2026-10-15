# 0008 Reading XLSX statements: fflate plus a small SpreadsheetML reader

Status: accepted (WS-03, 2026-10-16)

## Context
`packages/importers` has to read Bank of Georgia XLSX exports (`fixtures/statements/bog/`), and TBC exports later. The parsers are pure functions over a `Uint8Array`, run in the worker on Node, and must not use native modules. Money must never pass through a JS `number`.

The BoG file has a few traits a reader has to handle:

- Every element carries a namespace prefix (`<x:row>`, `<x:c>`), and the sheet XML starts with a BOM.
- Header cells use shared strings; data cells use `inlineStr`.
- Dates are Excel serial numbers in the 1900 system.
- Amounts are stored as `<v>-690.85</v>`. That text is already the exact decimal.

## Decision
Unzip with fflate 0.8.3 (MIT, pure JS, no dependencies, synchronous `unzipSync`). Parse the workbook with a SpreadsheetML reader of about 250 lines in `packages/importers/src/lib/xlsx.ts`. It returns every cell as `{ type, text }`, where `text` is the exact content of `<v>` or of the string, so amounts go from text to bigint minor units with no float in between.

The reader covers shared strings (including rich-text runs, minus phonetic runs), inline strings, `str`/`n`/`b`/`e`/`d` cells, any namespace prefix, sparse rows and cells, cells without `r`, XML entities, `_xHHHH_` escapes and the `date1904` flag. It ignores styles, formulas (it reads the cached value) and everything else. Only `xl/**/*.xml` and `.rels` entries are inflated, and any entry declaring more than 64 MB is skipped, as a guard against zip bombs.

## Alternatives
- SheetJS (`xlsx`): the npm release is stuck at 0.18.5; newer versions ship only from the vendor's CDN, which the lockfile and CI cannot pin cleanly. It returns numbers as JS numbers, so amounts would go through a float.
- ExcelJS 4.4.0: last published in 2024, heavy (streams, archiver, many transitive packages) and also number-based.
- read-excel-file and similar: number-based too, and built for tables with the header in row 1.
- `node:zlib` instead of fflate: no dependency at all, but it ties the parsers to Node. fflate also runs in a browser, which keeps a client-side preview of a column mapping possible later.

## Consequences
- We maintain the reader ourselves. Its tests build workbooks in memory (`src/test/build-xlsx.ts`), and a fuzz test feeds it mutated and truncated files. The 10k-row BoG workbook in the performance test is built and parsed in under 250 ms.
- A format we have not seen (for example a TBC export using cell types the reader ignores) may need small additions. If that list grows long, revisit this ADR.
- Number cells whose text has float noise (`1806.7600000000002`) are rounded to the currency's minor unit without a warning. Any other extra precision is rounded and reported as `amount_rounded`.
