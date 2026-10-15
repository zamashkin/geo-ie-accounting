# 0004 pg-boss for background jobs

Status: accepted

## Decision
Use pg-boss (queue stored in Postgres).

## Alternatives
- BullMQ + Redis: higher throughput, but adds Redis to run, back up and monitor. Throughput needs here are small.

## Consequences
Jobs can be enqueued in the same DB transaction as the data they depend on (transactional outbox for free). Revisit if job volume grows by orders of magnitude.
