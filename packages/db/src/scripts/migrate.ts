import { createDb } from '../client';
import { loadDbEnv } from '../env';
import { runMigrations } from '../migrate';

const { DATABASE_URL } = loadDbEnv();
const handle = createDb({
  connectionString: DATABASE_URL,
  max: 1,
  applicationName: 'ie-ledger-migrate',
});
try {
  await runMigrations(handle.db);
  console.log('Migrations applied.');
} finally {
  await handle.close();
}
