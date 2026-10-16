import { createDb } from '../client';
import { loadDbEnv } from '../env';
import { DEMO, seedDemo, seedDemoRates } from '../seed';

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
  console.log(
    `${result.createdLogin ? 'Created' : 'Kept'} demo login ${DEMO.userEmail} / ${DEMO.password} (local only).`,
  );
  const rates = await seedDemoRates(handle.db);
  console.log(
    `NBG rates for the BoG demo statement: ${rates.inserted} added, ${rates.unchanged} already stored.`,
  );
} finally {
  await handle.close();
}
