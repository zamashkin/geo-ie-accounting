import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` needs no database. `DATABASE_URL` is only read by studio/introspection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://ie_ledger:ie_ledger@localhost:5432/ie_ledger',
  },
  strict: true,
  verbose: true,
});
