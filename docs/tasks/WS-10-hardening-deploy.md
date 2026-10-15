# WS-10 Accountant mode, hardening, deploy

**Phase 4.**

## Deliver
- Accountant overview `/accountant`: all orgs where the user is accountant, with next deadline, unfiled periods, imports awaiting review, drift flags.
- Postgres RLS on tenant tables (`SET LOCAL app.org_id`), with tests showing a repository bug cannot leak cross-tenant data.
- Audit log UI with filters.
- Exports: ledger CSV, declaration summary PDF.
- OpenTelemetry traces web → api → worker (trace context passed through job payloads), Sentry in all three apps, dashboards documented.
- Perf: Lighthouse CI budgets enforced; bundle analysis report in CI artifacts.
- Production Dockerfiles (multi-stage, non-root), deploy per SPEC Q4, backups for Postgres, HTTPS.
- Public demo: seed script generating a realistic anonymised year, read-only demo login.
- README for reviewers: architecture diagram, ADR index, screenshots, "trade-offs and next steps".
