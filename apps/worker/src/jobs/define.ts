import { jobPayloads, type JobName, type JobPayload } from '@geo-ie-accounting/contracts';
import type { Job, PgBoss, Queue } from 'pg-boss';
import type { Logger } from 'pino';

export interface JobContext {
  job: Job<unknown>;
  log: Logger;
}

export interface JobDefinition<N extends JobName = JobName> {
  name: N;
  /** Queue options; merged over DEFAULT_QUEUE_OPTIONS. */
  queue?: Omit<Queue, 'name'>;
  // Method syntax (bivariant parameters) so definitions for different job names fit in one list.
  handler(payload: JobPayload<N>, ctx: JobContext): Promise<void>;
}

/** Keeps the payload type tied to the job name from packages/contracts. */
export function defineJob<N extends JobName>(def: JobDefinition<N>): JobDefinition<N> {
  return def;
}

/** Retries with exponential backoff, then the job moves to `<name>.dead` (ARCHITECTURE §8). */
export const DEFAULT_QUEUE_OPTIONS = {
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 600,
} satisfies Omit<Queue, 'name'>;

export const deadLetterQueue = (name: string) => `${name}.dead`;

/**
 * Creates the queue (and its dead-letter queue) and starts a worker. Payloads are validated
 * against the contracts schema before the handler runs; an invalid payload fails the job.
 */
export async function registerJob<N extends JobName>(
  boss: PgBoss,
  def: JobDefinition<N>,
  log: Logger,
): Promise<void> {
  const dead = deadLetterQueue(def.name);
  await boss.createQueue(dead);
  await boss.createQueue(def.name, { ...DEFAULT_QUEUE_OPTIONS, ...def.queue, deadLetter: dead });
  await boss.work(def.name, async (jobs) => {
    for (const job of jobs) {
      const jobLog = log.child({ job: def.name, jobId: job.id, attempt: job.retryCount });
      const parsed = jobPayloads[def.name].safeParse(job.data);
      if (!parsed.success) {
        // Do not log the payload: it may contain personal data.
        jobLog.error({ issues: parsed.error.issues.length }, 'invalid job payload');
        throw new Error(`Invalid payload for job ${def.name}`);
      }
      const started = Date.now();
      await def.handler(parsed.data as JobPayload<N>, { job, log: jobLog });
      jobLog.debug({ ms: Date.now() - started }, 'job completed');
    }
  });
}
