// Test database for integration tests (`*.int.test.ts`).
//
//   - TEST_DATABASE_URL set (CI service container): a fresh database is created on that server
//     for each call and dropped on close.
//   - Otherwise: a disposable Postgres 17 container is started with Testcontainers.
//
// Either way the migrations are applied, so tests see exactly what `pnpm db:migrate` produces.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDb, type DbHandle } from '../client';
import { runMigrations } from '../migrate';

export const TEST_POSTGRES_IMAGE = 'postgres:17.11-alpine';

export interface TestDatabase extends DbHandle {
  connectionString: string;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const external = process.env.TEST_DATABASE_URL;
  return external ? createOnServer(external) : startContainer();
}

async function startContainer(): Promise<TestDatabase> {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer(TEST_POSTGRES_IMAGE).start();
  const connectionString = container.getConnectionUri();
  const handle = createDb({ connectionString, max: 5, applicationName: 'ie-ledger-test' });
  await runMigrations(handle.db);
  return {
    ...handle,
    connectionString,
    close: async () => {
      await handle.close();
      await container.stop();
    },
  };
}

async function createOnServer(serverUrl: string): Promise<TestDatabase> {
  const name = `ie_ledger_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const connectionString = url.toString();
  const handle = createDb({ connectionString, max: 5, applicationName: 'ie-ledger-test' });
  await runMigrations(handle.db);
  return {
    ...handle,
    connectionString,
    close: async () => {
      await handle.close();
      const cleanup = new pg.Client({ connectionString: serverUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
