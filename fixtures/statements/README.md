# Statement fixtures

Real bank exports with personal data replaced. Used by `packages/importers` tests.

| Bank | Files | Notes |
|---|---|---|
| Bank of Georgia | `bog/` | GBP account, CSV + XLSX of the same period. See `bog/FORMAT.md` |
| Bank of Georgia (synthetic) | `bog/synthetic-gbp-2025-06-unassigned.csv` | Written by hand, no real data. One income line whose printed GEL is 5 tetri off the NBG conversion, and one bank fee the parser can't classify. Used by the commit tests (422 unassigned row, bank GEL warning) |
| TBC | missing | needed for WS-03 |

## Adding a statement

1. Put the original export in `raw/`. It is gitignored and must never be committed.
2. Add the real → fake values to `raw/mapping.json`: names, IBANs, account numbers, tax IDs, bank client codes, client names and addresses, operation IDs. Add the most telling ones to `forbid`.
3. Run `python3 -I tools/anonymise_statement.py fixtures/statements/raw/mapping.json "raw/<file>" <bank>/<bank>-<ccy>-<yyyy-mm>.<ext>`. It fails if a forbidden token survives.
4. Open the output and read it yourself before committing. The script only replaces what the mapping lists.
