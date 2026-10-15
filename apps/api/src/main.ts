import { createDb } from '@ie-ledger/db';
import { sql } from 'drizzle-orm';
import { buildApp, LOG_REDACT_PATHS } from './app';
import { loadEnv } from './env';
import { createRatesRouteDeps } from './routes/rates/index';

const env = loadEnv();

const { db, close: closeDb } = createDb({
  connectionString: env.DATABASE_URL,
  applicationName: 'ie-ledger-api',
  // Runs only after startup, by which time `app` exists.
  onIdleClientError: (err) => {
    app.log.warn({ err }, 'idle database connection failed; the pool will reconnect');
  },
});

const app = await buildApp(
  {
    version: env.APP_VERSION,
    webOrigin: env.WEB_ORIGIN,
    logger: {
      level: env.LOG_LEVEL,
      redact: LOG_REDACT_PATHS,
      ...(env.LOG_PRETTY ? { transport: { target: 'pino-pretty' } } : {}),
    },
  },
  {
    checkDatabase: async () => {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    rates: createRatesRouteDeps({ db, connectionString: env.DATABASE_URL }),
  },
);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await closeDb();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}
process.once('SIGINT', (s) => void shutdown(s));
process.once('SIGTERM', (s) => void shutdown(s));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.fatal({ err }, 'failed to start');
  await closeDb();
  process.exit(1);
}
