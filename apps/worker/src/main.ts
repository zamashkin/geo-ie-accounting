import { pino } from 'pino';
import { loadEnv } from './env';
import { jobs } from './jobs/index';
import { startWorker } from './worker';

const env = loadEnv();
const log = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker' },
  ...(env.LOG_PRETTY ? { transport: { target: 'pino-pretty' } } : {}),
});

const worker = await startWorker({ connectionString: env.DATABASE_URL, log, jobs });

if (env.WORKER_SMOKE_JOB) {
  const id = await worker.boss.send('noop', { message: 'boot smoke test' });
  log.info({ jobId: id }, 'enqueued smoke-test noop job');
}

let stopping = false;
async function shutdown(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down; waiting for in-flight jobs');
  try {
    await worker.stop(env.SHUTDOWN_TIMEOUT_MS);
    process.exit(0);
  } catch (err) {
    log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}
process.once('SIGINT', (s) => void shutdown(s));
process.once('SIGTERM', (s) => void shutdown(s));
