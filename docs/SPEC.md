# IE Ledger: product spec

Working name: **IE Ledger** (rename later; see Open questions).

Bookkeeping and tax tool for individual entrepreneurs (IE, "ინდმეწარმე") in Georgia with **small business status** (1% turnover tax). Users import bank statements, the app converts foreign-currency income to GEL at the official National Bank of Georgia (NBG) rate for the date of receipt, keeps a double-entry ledger, and produces the numbers needed for the monthly declaration on rs.ge.

This is also a portfolio project. It has to work for real users, and the repo has to read as senior-level engineering: clear architecture, decisions documented in ADRs, tests, observability, CI.

## 1. Users

| Persona | Need |
|---|---|
| **Freelancer IE** (primary) | Paid in USD/EUR by foreign clients into TBC / Bank of Georgia accounts. Wants to know "what do I declare this month and how much tax do I pay" without a spreadsheet. |
| **Accountant** | Manages 5–50 IE clients. Needs to switch between client workspaces, review imports, and mark declarations filed. |
| **Viewer** | Read-only access (e.g. partner, auditor). |

## 2. Domain rules

Rules live in `packages/domain/src/tax/rules.ts` as versioned, dated config, never as constants scattered through code. Each rule set has an `effectiveFrom` date so historical periods are calculated with the rules that applied then.

Checked on **2026-10-15** against the consolidated Tax Code of Georgia on matsne.gov.ge (consolidated version 30/09/2026, doc 1043717) and the live NBG rates API. The latest amendments to Articles 88–90 are Law No 3922 of 13.12.2023. "Secondary" means the rule comes from professional or advisory sources, not the primary legal text, and needs an accountant's sign-off before release.

### 2.1 Rates and limits

| Rule | Verified rule | Source | Confidence |
|---|---|---|---|
| Base rate | 1% of taxable income (gross receipts from economic activity, no expense deductions) | Tax Code Art. 90(1) | Primary |
| Annual limit | GEL 500,000 gross income from economic activity per calendar year (GEL 700,000 for wine and agro tourism operators; out of scope for v1) | Art. 88(3), 89(2)(a), 90(2) | Primary |
| Above the limit | **3% on all taxable income from the start of the month in which the limit is crossed, through 31 December.** It applies to the whole month's income, not only the excess. Earlier months are not recalculated. | Art. 90(2) | Primary |
| Loss of status | Revoked from 1 January of the next year **only if the limit is exceeded in each of 2 consecutive calendar years**. Exceeding it once just means 3% for the rest of that year. | Art. 89(2)(a), 89(3) | Primary |
| Other revocation | On request (from the 1st of the following month), prohibited activity, 3+ cash register fines in a year, ceasing to be an IE | Art. 89(2)(b–e) | Primary |
| Re-applying after cancellation | Only from the next tax year | Minister of Finance Order N38 (published 06.02.2026, amending Order N999) | Secondary |
| Status start date | Since March 2026, status applies **from the date of the application**, mid-month included. Before that it started on the 1st of the following month. | Order N38/2026 | Secondary |
| Losses | Not carried forward | Art. 91(5) | Primary |

### 2.2 What counts as taxable income

- Income from economic activity counts. Art. 90(3) wording: "incomes earned from a Georgian-based source", excluding salary and the Art. 88(3) types.
- Not taxed at 1% and **not counted toward the limit** (Government Decree No 415, under Art. 88(3)): salary; rental income; gains from selling assets; interest; dividends; royalties; gifts; inheritance; gambling winnings. These are taxed under the general regime (20%), which the app does not calculate in v1. The app records them as non-SBS income and shows a notice. *Secondary: the list should be checked against the current Decree 415 text.*
- Not income at all: transfers between own accounts, currency conversion at the bank, owner top-ups, loans received, refunds of own payments. The ledger model handles these (non-income accounts).
- **Excluded activities** (Decree 415, Annex 4): licensed activities, medical, architectural, legal, notarial, audit, **consulting of any kind**, currency exchange and financial intermediation, gambling, staffing, excise goods. Since 01.02.2025, construction services (NACE 41.2, 42, 43) to companies or other IEs are also excluded. The app does not judge eligibility. Onboarding shows this list with a link to the rules. *Secondary.*

### 2.3 Currency conversion (closes Q5)

- Rule: foreign-currency amounts are converted at "the official exchange rate of lari defined by the National Bank of Georgia … as of the transaction day" (Art. 73(10)). Use the rate valid on the receipt date, not the bank's own conversion rate.
- NBG sets each rate around 17:00 Tbilisi time on a business day, valid from the next calendar day until the next rate is set. Weekend and holiday dates therefore use the last rate set: a Saturday, Sunday or Monday receipt uses the rate set on Friday evening. The API resolves this itself: `GET https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/?currencies=USD&date=YYYY-MM-DD` returns the rate valid on that date, with `validFromDate`. Checked live on 2026-10-15 for 9–12 Oct 2026.
- Rates have 4 decimal places and come with a `quantity` (units of foreign currency per rate).
- Store both the requested date and `validFromDate`; show the rate date in the UI.

### 2.4 Filing

| Rule | Verified rule | Source | Confidence |
|---|---|---|---|
| Monthly return + payment | By the **15th of the month after** the reporting month | Art. 93(11) | Primary |
| Zero returns | Required every month while the status is active, even with no income. Not filing is not treated as a zero return. | Order N38/2026 | Secondary |
| Return lines (from the Dec 2024 period on) | Line 15: cumulative income since 1 January. Lines 18–21: income by payment method: **18 cash via cash register, 19 POS terminal, 20 received to bank account (incl. transfers), 21 other** (Order N390 amending Order N999, Appendix 5) | Secondary |
| Recognition method | The return supports **cash method** (lines 18–21) and **accrual method** (adds lines 22–24: accrued not received, previously taxed now received, advances). v1 supports cash method only and states this in onboarding. | Order N999 Appendix 5 | Secondary |
| Annual return | Simplified annual income return by 1 April of the following year | Secondary |
| Records | Art. 91 requires a special records book; documents kept 3 years from the end of the relevant tax year (cut from 6 by Order N38/2026) | Art. 91(1), Order N38 | Mixed |
| VAT | Separate regime: VAT registration is required once taxable supplies pass GEL 100,000. Out of scope for v1, but the dashboard warns when Georgian-client income approaches it. | Secondary |

### 2.5 Related non-tax rule

From 2026, foreign nationals working in Georgia, including IEs, need a labour activity permit (system launched 01.03.2026; enforcement for self-employed from 01.05.2026). This is not a tax rule and the app doesn't track it. Onboarding mentions it in one line with a link. *Secondary.*

The app **never files anything** on rs.ge. It shows the figures, laid out like the return lines, and the user files them.

## 3. Features by milestone

### M1: Ledger core + exchange rates
- Workspace (organization) with one owner; chart of accounts seeded on creation (bank accounts per currency, income, expense, owner equity, FX clearing, tax payable).
- Manual transactions: create, view, reverse. No edits or deletes of posted transactions; corrections are reversing entries.
- NBG rates: daily sync for USD, EUR, GBP (configurable list); backfill for any date range; rates viewable in UI.
- Every posting carries its GEL equivalent and the rate snapshot used.
- Workspace tax settings: SBS start date (can be mid-month), accounting method (cash only in v1), special operator flag (reserved, not supported in v1).
- Income accounts are classified `sbs` (1%, counts toward the limit) or `non_sbs` (rental, interest, dividends, etc.; excluded from the limit and from the 1% figures).

### M2: Bank statement import
- Upload CSV/XLSX statement for a chosen bank account. Income imported from a bank statement gets payment method `bank` (return line 20) by default.
- Parsers for **TBC Bank** and **Bank of Georgia** exports, plus a **generic CSV** with user-defined column mapping (saved per account).
- Pipeline: upload → parse (background job) → preview → commit.
- Preview shows each row as `new`, `duplicate` (already imported), or `skipped`, with a suggested category from rules.
- Duplicate detection is deterministic (see ARCHITECTURE §6). Re-uploading the same file never creates duplicate transactions.
- Categorisation rules: "if counterparty/description matches X → account Y, taxable yes/no". Rules can be created from a preview row.
- Live progress of parse/commit over SSE.

### M3: Tax and dashboard
- Monthly declaration view laid out like the rs.ge return: line 15 (cumulative income since 1 Jan), lines 18–21 (income by payment method: cash register, POS, bank account, other), rate applied (1% or 3%), tax due, the transactions behind each line, and the deadline (15th).
- Rate switch per SPEC §2.1: once cumulative SBS income crosses GEL 500,000, the whole month of crossing and every later month that year use 3%.
- Months before the SBS start date and days before it in the start month are excluded and flagged.
- Zero months still produce a "file a zero return" item.
- Mark a period as `filed` (stores an immutable snapshot of the figures). If later changes affect a filed period, show a "filed figures differ" warning; never silently change filed snapshots.
- Year-to-date turnover vs the GEL 500,000 limit, with warnings at 80% and 95%, a clear explanation of the 3% switch, and a "second consecutive year over the limit means losing the status" warning when the previous year also went over.
- Annual return reminder (1 April) with yearly totals.
- VAT notice when Georgian-source income approaches GEL 100,000 (notice only).
- Dashboard: monthly income chart (GEL), income by client/counterparty, currency mix, upcoming deadline.

### M4: Invoices
- Clients (name, country, email, default currency).
- Invoices with line items, currency, due date, PDF generation (background job), sequential numbering per workspace.
- Match an imported incoming payment to an invoice (suggested by amount + currency + counterparty); invoice becomes `paid`.

### M5: Accountant mode and hardening
- Invite members by email with roles `owner | accountant | viewer`.
- Accountant sees a client switcher and a cross-client overview (deadlines, unfiled periods, imports awaiting review).
- Audit log UI per workspace.
- Export: CSV of ledger, PDF of declaration summary.
- Performance budget enforced in CI; production deploy; seeded public demo account.

### Out of scope (v1)
Direct bank API integrations, filing on rs.ge, VAT, accrual method, 20% general-regime calculations, wine/agro tourism operators, payroll, non-IE entities, mobile apps, multi-language beyond EN (structure i18n so KA/RU can be added).

## 4. Non-functional requirements

- **Correctness over everything for money.** Integer minor units, no floats, balanced transactions enforced in the database.
- **Tenancy isolation**: every query is scoped by organization; cross-tenant access is a test case, not an assumption.
- **Auditability**: every mutation writes an audit log row with actor, before/after.
- **Idempotency**: all mutating API calls accept `Idempotency-Key`.
- **Performance**: transaction list of 50k rows stays smooth (server pagination + virtualisation). Web LCP < 2.0s and INP < 200ms on the dashboard (lab, mid-tier mobile profile). Initial JS budget per route enforced in CI.
- **Accessibility**: WCAG 2.2 AA on core flows; keyboard-complete import wizard.
- **Privacy**: statements are financial data. Encrypted at rest in object storage, never logged, deletable by the owner.
- **Observability**: traces across web → api → worker, errors to Sentry, structured logs with request ID.

## 5. Success criteria

1. A real IE can import 12 months of TBC statements and get monthly declaration figures matching their own spreadsheet to the tetri.
2. A reviewer can `git clone && docker compose up && pnpm dev` and log into a seeded demo in under 5 minutes.
3. CI is green: typecheck, lint, unit, integration (real Postgres), e2e (Playwright), perf budget, migration check.

## 6. Open questions

| # | Question | Blocks |
|---|---|---|
| Q1 | Final product name and domain | M5 deploy |
| Q2 | BoG done (GBP account, CSV + XLSX, `fixtures/statements/bog/`). Still needed: TBC exports, plus BoG exports for a USD/GEL account and a statement with outgoing payments | M2 parsers |
| Q3 | Primary rules verified 2026-10-15 (§2). Still need an accountant to confirm the *secondary* items: Decree 415 lists, return lines 15/18–21, the annual return, the Order N38 changes | M3 release |
| Q4 | Hosting choice (Hetzner VPS + Docker vs Fly.io) | M5 |
| ~~Q5~~ | Answered in §2.3: the rate valid on the receipt date, with weekends and holidays using the last rate set | — |
| Q6 | Rounding of the GEL equivalent and of the tax amount on the return (per transaction or per total; to the tetri or the lari?) | M3 |
