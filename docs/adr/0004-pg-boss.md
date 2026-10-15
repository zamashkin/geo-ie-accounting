# 0004 pg-boss for background jobs

Status: accepted (version pinned in WS-00, 2026-10-15)

## Decision
Use pg-boss (queue stored in Postgres). Pinned: **pg-boss 12.38.0**.

In v12 a queue must be created (`createQueue`) before `send`/`work`, `work` handlers receive an array of jobs, and `getJobById` is deprecated in favour of `findJobs`. The worker creates each queue with retries and exponential backoff (`retryLimit 5`, `retryBackoff`) and a dead-letter queue `<name>.dead`. Payloads are validated against `packages/contracts/src/jobs.ts` before the handler runs.

## Alternatives
- BullMQ + Redis: higher throughput, but adds Redis to run, back up and monitor. Throughput needs here are small.

## Consequences
Jobs can be enqueued in the same DB transaction as the data they depend on (transactional outbox for free). Revisit if job volume grows by orders of magnitude.
