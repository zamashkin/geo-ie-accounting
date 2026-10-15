import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const WorkerEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanString.default(false),
  /** How long in-flight jobs get to finish on SIGTERM before the worker exits. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  /** Enqueue one `noop` job at boot: a quick end-to-end check of the queue in development. */
  WORKER_SMOKE_JOB: booleanString.default(false),
});
export type WorkerEnv = z.output<typeof WorkerEnv>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = WorkerEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid worker environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
