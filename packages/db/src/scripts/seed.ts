import { createDb } from '../client';
import { loadDbEnv } from '../env';
import { DEV, seedDev, seedDevRates } from '../seed';

const { DATABASE_URL } = loadDbEnv();
const handle = createDb({
  connectionString: DATABASE_URL,
  max: 1,
  applicationName: 'geo-ie-accounting-seed',
});
try {
  const result = await seedDev(handle.db);
  console.log(
    result.createdOrg
      ? `Seeded dev org ${result.orgId} with ${result.accounts} accounts.`
      : `Dev org ${result.orgId} already exists; nothing to do.`,
  );
  console.log(
    `${result.createdLogin ? 'Created' : 'Kept'} dev login ${DEV.userEmail} / ${DEV.password} (local only).`,
  );
  const rates = await seedDevRates(handle.db);
  console.log(
    `NBG rates for the BoG statement fixture: ${rates.inserted} added, ${rates.unchanged} already stored.`,
  );
} finally {
  await handle.close();
}
