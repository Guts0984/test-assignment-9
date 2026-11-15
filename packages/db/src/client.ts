import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** Anything you can run queries on: the root db or a transaction. */
export type Queryable = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export type DbHandle = { db: Db; pool: pg.Pool; close: () => Promise<void> };

export type CreateDbOptions = { max?: number; applicationName?: string };

export const createDb = (url: string, options: CreateDbOptions = {}): DbHandle => {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'restaurant',
  });
  // An idle client dropping must not crash the process with an unhandled 'error' event.
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
};
