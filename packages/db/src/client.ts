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
  /**
   * Called when an idle pooled connection fails (e.g. Postgres restarted). Without a listener
   * node-postgres emits an unhandled 'error' event and the process crashes. The pool discards
   * the broken client and reconnects on the next query.
   */
  onIdleClientError?: (err: Error) => void;
}

// int8 (bigint) columns come back as strings from node-postgres; Drizzle's `mode: 'bigint'`
// converts them to bigint. numeric stays a string (rates are parsed in packages/domain).

export function createDb({
  connectionString,
  max = 10,
  applicationName,
  onIdleClientError = () => undefined,
}: CreateDbOptions): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max,
    // node-postgres waits forever for a connection by default.
    connectionTimeoutMillis: 5_000,
    ...(applicationName ? { application_name: applicationName } : {}),
  });
  pool.on('error', onIdleClientError);
  const db = drizzle({ client: pool, schema });
  return { db, pool, close: () => pool.end() };
}
