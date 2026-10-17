import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { registerJob, type JobDefinition } from './jobs/define';

export interface WorkerOptions {
  connectionString: string;
  log: Logger;
  jobs: readonly JobDefinition[];
}

export interface RunningWorker {
  boss: PgBoss;
  /** Stops polling, waits up to `timeoutMs` for in-flight jobs, closes the pool. */
  stop: (timeoutMs: number) => Promise<void>;
}

export async function startWorker({
  connectionString,
  log,
  jobs,
}: WorkerOptions): Promise<RunningWorker> {
  const boss = new PgBoss({ connectionString, application_name: 'geo-ie-accounting-worker' });
  boss.on('error', (err) => {
    log.error({ err }, 'pg-boss error');
  });
  boss.on('warning', (warning) => {
    log.warn({ warning }, 'pg-boss warning');
  });

  await boss.start();
  for (const job of jobs) {
    await registerJob(boss, job, log);
  }
  log.info({ jobs: jobs.map((j) => j.name) }, 'worker started');

  return {
    boss,
    stop: async (timeoutMs) => {
      await boss.stop({ graceful: true, timeout: timeoutMs });
      log.info('worker stopped');
    },
  };
}
