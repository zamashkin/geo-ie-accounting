# NBG rate fixtures

Real responses from the National Bank of Georgia rates endpoint, recorded on 2026-10-15 by
`packages/nbg/scripts/record-fixtures.ts`. Tests read these files and never call NBG.

```
GET https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/?currencies=<CODE>&currencies=<CODE>&date=YYYY-MM-DD
```

File names are `<codes joined by ->_<requested date>.json`. Each body is NBG's JSON, pretty-printed.

## What the cases show

| Files | Case |
|---|---|
| `EUR-GBP-USD_2026-10-08` … `_2026-10-16` | Nine consecutive days with three currencies per request. |
| `EUR-GBP-USD_2026-10-13` | Plain weekday: Tuesday's rate was set Monday at 17:01, valid from Tuesday. |
| `EUR-GBP-USD_2026-10-10` … `_2026-10-12` | Weekend and the Monday after it. All three return the rate set on Friday 9 Oct, with `validFromDate` Saturday 10 Oct. |
| `EUR-GBP-USD_2026-10-15` | Day after a public holiday (14 Oct, Svetitskhovloba). No rate was set on the 14th, so the 15th still uses the rate valid from the 14th. |
| `USD_2026-04-08` … `_2026-04-15` | 9 April (National Unity Day) and Orthodox Easter (10 to 13 April). The rate set on 8 April is valid from 9 April through 14 April. |
| `GBP_2025-06-04`, `_05`, `_11` | GBP 3.6924, 3.6948 and 3.6858, the rates the BoG statement fixture relies on. |
| `AMD-JPY-USD_2026-10-14` | Rates quoted per 1000 units (AMD) and per 100 units (JPY). |
| `XXX_2026-10-14` | A code NBG does not publish: HTTP 200 with `[]`. |
| `unsorted_USD-EUR_2026-10-14` | Codes not in alphabetical order. For some orders NBG answers `[]`; `USD,EUR` is one of them. The client always sends codes sorted. |

## Things the fixtures confirm

- Several currencies go in as repeated `currencies=` parameters. A comma-separated list returns `[]`.
- A date after the latest rate (for example next week) returns the latest rate. `validFromDate` is
  never later than the requested date.
- `rateFormated` always has four decimals (`"2.4760"`). `rate` is the same value as a JSON number
  (`2.476`). The client reads the string.
- The set time in `currencies[].date` is Tbilisi wall-clock time with a `Z` suffix. At 16:36 UTC on
  15 October the rate for the 16th was already published with `"date": "2026-10-15T17:01:15.076Z"`,
  which would be in the future if it were really UTC. The client reads the clock time as UTC+04:00
  (Georgia has had no daylight saving time since 2005).

To re-record, run `pnpm --filter @ie-ledger/nbg record-fixtures` and review the diff. Rates for past
dates should not change.
