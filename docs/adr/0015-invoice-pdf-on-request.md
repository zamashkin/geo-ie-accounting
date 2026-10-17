# 0015 Invoices: PDF rendered on request, numbers per org and year

Status: accepted (WS-09, 2026-10-17)

## Context
ARCHITECTURE §8 and the WS-09 brief plan an `invoice.render_pdf` worker job that uploads the file to S3, emits `invoice.pdf_ready` over SSE, and hands out a signed URL. The MVP already does its other work inside the request (ADR 0012), and the worker runs no jobs besides rates. An invoice has a handful of lines. `@react-pdf/renderer` renders one in well under a second, most of it spent loading the fonts the first time.

The brief asks for numbers that are "sequential per workspace" and gapless. The user asked for numbers per year, like `2026-001`.

## Decision
- `GET /v1/orgs/:orgId/invoices/:invoiceId/pdf` renders the invoice with `@react-pdf/renderer` (pinned at 4.9.0) in the API process and streams the bytes back with `Content-Disposition: attachment` (or `inline` with `?inline=true`). Nothing is stored. `invoices.pdf_key`, the `invoice.render_pdf` job and the `invoice.pdf_ready` event stay unused for now.
- Noto Sans and Noto Sans Georgian (SIL OFL 1.1) live in `apps/api/assets/fonts` with their licence and are embedded in every PDF. Text styles list both families, so Georgian characters fall back to the Georgian face. Hyphenation is off.
- Issuing freezes what gets printed: it stores the seller (from the org profile), client and bank-account details in `invoices.snapshot`. A later edit to the client or to the profile does not change an issued invoice. A draft prints the current details and a DRAFT mark.
- Issuing takes the next sequence of the issue year from `invoice_sequences(org_id, year, last_seq)`. It does this with an `INSERT … ON CONFLICT DO UPDATE … RETURNING` in the request transaction. The row lock lasts until COMMIT, so concurrent issues in one org and year queue up, and a rolled-back issue hands its number back. The printed number is `{prefix}{year}-{seq:03}`. The prefix (`organizations.invoice_prefix`, empty by default) is set on the workspace settings page and applies to invoices issued after the change. Unique indexes on (org, year, seq) and (org, number) back this up.
- A database trigger rejects edits to an issued invoice except status changes along `issued → paid | void` and `paid → issued` (when a payment is unmatched). It also rejects changes to an issued invoice's lines and deletion of anything but a draft. A void invoice keeps its number.
- Invoices and payment matches post nothing to the ledger. Income is still the imported bank receipt, and the tax figures never read invoices.
- No VAT: SBS entrepreneurs are generally not VAT payers, and SPEC lists VAT as out of scope. A free-text invoice note in the profile can carry a remark such as "Not registered for VAT".

## Alternatives
- **Worker job, S3 and SSE as planned**: gives cached files and keeps rendering off the API. It needs the S3 client, a job, an event and a client-side wait before anyone can download a one-page document.
- **Render in the browser**: puts react-pdf and the fonts (about 1.3 MB) in the web bundle, and the server could no longer vouch for what the PDF says.
- **One sequence per org, never reset**: simpler, but not the per-year format the user asked for.

## Consequences
Every download renders again, which costs the API a little CPU per request. The fonts are registered once per process. If downloads ever get heavy, the job from ARCHITECTURE §8 can come back: it would render the same `InvoiceDocument` from the same `InvoiceView`, so the contract does not change. Since the snapshot freezes what is printed, re-rendering an issued invoice always gives the same document.
