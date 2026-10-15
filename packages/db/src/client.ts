import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** A Drizzle transaction handle; repositories accept `Db | Tx`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  connectionString: string;
  /** Pool size. Default 10. */
  max?: number;
  applicationName?: string;
}

// int8 (bigint) columns come back as strings from node-postgres; Drizzle's `mode: 'bigint'`
// converts them to bigint. numeric stays a string (rates are parsed in packages/domain).

export function createDb({
  connectionString,
  max = 10,
  applicationName,
}: CreateDbOptions): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max,
    ...(applicationName ? { application_name: applicationName } : {}),
  });
  const db = drizzle({ client: pool, schema });
  return { db, pool, close: () => pool.end() };
}
