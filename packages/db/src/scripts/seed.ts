import { createDb } from '../client';
import { loadDbEnv } from '../env';
import { seedDemo } from '../seed';

const { DATABASE_URL } = loadDbEnv();
const handle = createDb({
  connectionString: DATABASE_URL,
  max: 1,
  applicationName: 'ie-ledger-seed',
});
try {
  const result = await seedDemo(handle.db);
  console.log(
    result.createdOrg
      ? `Seeded demo org ${result.orgId} with ${result.accounts} accounts.`
      : `Demo org ${result.orgId} already exists; nothing to do.`,
  );
} finally {
  await handle.close();
}
