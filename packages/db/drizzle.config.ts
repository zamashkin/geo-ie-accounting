import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` needs no database. `DATABASE_URL` is only read by studio/introspection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://geo_ie_accounting:geo_ie_accounting@localhost:5432/geo_ie_accounting',
  },
  strict: true,
  verbose: true,
});
