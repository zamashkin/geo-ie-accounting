# Bank of Georgia statement export: format notes

Fixtures: `bog-gbp-2025-06.csv` and `bog-gbp-2025-06.xlsx`. Both are the same real GBP account statement for 15.05.2025–15.06.2025, anonymised with `tools/anonymise_statement.py`. Amounts, dates and rates are real; names, IBANs, tax numbers and bank IDs are fake. One export covers **one currency account**.

The statement has 4 operations:

| Date | Type | GBP | Meaning |
|---|---|---|---|
| 2025-06-04 | PMI | +1,180.00 | Incoming transfer from a foreign client → **SBS income candidate** |
| 2025-06-05 | CCO | −690.85 | Conversion GBP → USD 900.00 to own USD account → **not income** |
| 2025-06-05 | CCO | −489.00 | Conversion GBP → GEL 1,785.83 to own GEL account → **not income** |
| 2025-06-11 | PMI | +364.00 | Incoming transfer from a foreign client → **SBS income candidate** |

## Rates: checked against NBG

- For incoming payments the bank's rate column equals the **NBG official rate** for that date: GBP 3.6924 (04.06), 3.6858 (11.06), checked against the NBG API on 2026-10-15. The bank's GEL equivalent = amount × NBG rate (1180 × 3.6924 = 4357.03).
- For conversions (CCO) the rate column is the **deal rate** (GBP/USD 1.302736, GBP/GEL 3.652). The GEL-equivalent column still uses the NBG rate of the day (690.85 × 3.6948 = 2552.55).
- Parser rule: capture the bank's GEL equivalent as `bankGelAmount`. The import pipeline compares it with our own `toGel()` and raises a warning when they differ by more than 1 tetri. Never use the bank's figure as the source of truth.

## XLSX (preferred: structured, has stable IDs)

- One sheet, `Statement of Account`. Metadata in rows 5–13 as label/value pairs in columns B/C: `Account Owner:`, `Number Taxpayer: `, `Account N:` (`<IBAN><CCY> (<account no>)`), `Currency: `, ` Period: ` (`dd.mm.yyyy-dd.mm.yyyy`), opening/closing balances in the account currency and in GEL. Labels have stray spaces and the typo `Begining`. Match them trimmed and case-insensitive.
- Header row 15, data from row 16. Header text has stray spaces (`" Credit"`, `" Recipient Name"`). Locate columns by trimmed header name, never by letter.
- Dates (`Date`) are **Excel serial numbers** (1900 date system): 45812 = 2025-06-04.
- Data strings are `inlineStr` cells; headers use shared strings. The XLSX library must support both.
- No subtotal rows. Per-day turnover and balance are repeated on every row (`Turnover Debit`, `Balance at end of day`, ...). Ignore them except for the reconciliation check below.

| Header | Use |
|---|---|
| `Date` | booked date |
| `Doc N` | document number (`PMI…` for incoming, numeric for CCO) |
| `Loro Account` | counterparty account. For CCO it's **our own IBAN with another currency suffix** |
| `Debit` / ` Credit` | unsigned amounts, one of them filled |
| `Rate` | see Rates above |
| `Debit Amount in Gel` / `Credit Amount in Gel` | bank's GEL equivalent |
| `Entry Comment` | full description |
| `Operation Type` | `PMI` = incoming payment, `CCO` = currency conversion. Other codes are unknown so far: map them to `other` and add a warning |
| `Operation ID`, `Ref` | numeric, stable → `bankReference` for the dedupe hash (prefer `Operation ID`) |
| `Sender Name` / `Sender Number Taxpayer` / `Sender Account N` / `Sender Bank Code` / `Sender Bank Name` | counterparty for incoming |
| ` Recipient Name` … `Recipient Bank Name` | counterparty for outgoing |
| `Nomination` | payment purpose |
| `Amount` / `Amount in Gel` | **signed** amount (negative = debit). Easiest single source |
| `Destination Amount` / `Destination Ccy` | counter-amount for conversions (USD 900, GEL 1785.83) |
| `Balance` | running balance after the row. Use to reconcile: opening + Σ amounts = closing |

## CSV (report layout, not a flat table)

- ASCII. **Georgian text uses the legacy Latin "font" transliteration** (AcadNusx-style keyboard mapping), not Unicode Georgian: `TariRi` = თარიღი (date), `debeti`/`krediti`, `kursi` (rate), `eqv.lari` (GEL equivalent), `operaciis Sinaarsi` (description). Match these exact ASCII strings. Case matters, because upper/lower case maps to different letters.
- Line endings are mixed CRLF and LF. Quoted fields contain **embedded newlines followed by a tab and spaces**.
- Rows 1–6 are metadata: owner (`angariSis mflobeli:`), the bank's client code (`bankSi angariSis mflobelis kodi:`, a different number from the tax ID), account (`angariSis #:<IBAN><CCY> (<no>)`), period (`periodi: dd.mm.yy-dd.mm.yy`, 2-digit year). Rows have inconsistent column counts.
- Header row: `"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"`.
- Non-transaction rows, identified by the first or second column:
  - `sawyisi naSTi` (opening balance) is in the **doc # column**, and the **debit column holds the currency code** (`GBP`)
  - `brunva` (daily turnover), `naSTi` (daily balance), `sul brunva` (total turnover)
  - `saboloo naSTi` (closing balance), with its date as `dd.mm.yy`
- Transaction dates are `dd.mm.yyyy`. Amounts are plain decimals with a `.` separator. Amounts *inside descriptions* use thousands separators (`GBP1,180.00`).
- Incoming description: `"<details>: \n\t  Incoming Transfer - Amount: GBP1,180.00; Sender: <name>\<address>; Account: <acc>; Bank: <name> <BIC>; Details: <details>"`. Parse the `key: value; ` pairs after the first line.
- Conversion description: `" Payment - Amount GBP690.85; Foreign Exchange. FX Rate:1.302736. Counter-amount: USD900.. Currency Exchange"`. Note the double dot after a whole number.
- The CSV has **no operation ID**. Dedupe falls back to date + amount + doc number (`sabuTis #`).

## Backslashes are SWIFT line wraps

Long text fields (names, addresses, details) are cut into **35-character lines joined with `\`**, sometimes mid-word: `PETROV NIKOLAI SERGEEVICH PETROV NI\KOLAI SERGEEVICH`. For a counterparty name, take the text before the first `\` of `Sender Name`. To show full text, join the segments without a separator. Never treat `\` as an escape character.

## Classification hints for the import pipeline

- `PMI`, credit, sender account not one of our own accounts → suggest an SBS income account. Payment method `bank` (return line 20).
- `CCO`, or a `Loro Account` matching one of our own IBANs → FX conversion between own accounts (FX Clearing). Not income. When both sides are imported (GBP and USD statements), match them on `Operation ID`/date/amount so the conversion isn't booked twice.
- The client's tax number (`Doc Payer Inn`) shows **our own** tax number on incoming foreign payments. Don't use it to identify the counterparty.
