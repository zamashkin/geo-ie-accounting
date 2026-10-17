// Builds the public demo workspaces and the read-only demo login (ADR 0016):
//
//   pnpm db:seed:demo                       # "today" = today in Tbilisi
//   DEMO_TODAY=2026-10-17 pnpm db:seed:demo # pin "today" (same output on every run)
//   pnpm db:seed:demo --force               # rebuild even if already built for that day
//
// Idempotent: a second run for the same day changes nothing. A run for another day (or a newer
// generator) retires the old demo workspaces and builds new ones. Needs a migrated database.
import { IsoDate } from '@geo-ie-accounting/contracts';
import { createDb, loadDbEnv } from '@geo-ie-accounting/db';
import { createNbgClient, tbilisiDate } from '@geo-ie-accounting/nbg';
import { DEMO_LOGIN } from '../src/demo/profile';
import { DemoRates } from '../src/demo/rates';
import { seedDemoWorkspaces } from '../src/demo/seed';

const asOf = IsoDate.parse(process.env.DEMO_TODAY ?? tbilisiDate(new Date()));
const { DATABASE_URL } = loadDbEnv();
const handle = createDb({
  connectionString: DATABASE_URL,
  max: 2,
  applicationName: 'geo-ie-accounting-seed-demo',
});

try {
  // Recorded NBG rates; NBG itself only for days after the recording.
  const rates = DemoRates.load(createNbgClient());
  if (asOf > rates.coveredTo) {
    console.log(`Rates after ${rates.coveredTo} come from NBG (network).`);
  }
  const result = await seedDemoWorkspaces({
    db: handle.db,
    asOf,
    rates,
    force: process.argv.includes('--force'),
    log: (m) => {
      console.log(m);
    },
  });
  if (result.unchanged) {
    console.log(`Demo workspaces for ${asOf} already built; nothing to do (--force rebuilds).`);
  } else if (result.retired > 0) {
    console.log(`Retired ${result.retired} older demo workspace(s).`);
  }
  for (const w of result.workspaces) console.log(`  ${w.name}: /o/${w.orgId}`);
  console.log(
    `Demo login (read-only): ${DEMO_LOGIN.email} / ${DEMO_LOGIN.password}. ` +
      'Start the API with DEMO_MODE=true to offer it on the sign-in page.',
  );
} finally {
  await handle.close();
}
