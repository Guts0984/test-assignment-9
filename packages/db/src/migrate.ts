import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client';

export const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

/** Applies pending migrations. Safe to run repeatedly. */
export const runMigrations = async (db: Db): Promise<void> => {
  await migrate(db, { migrationsFolder });
};
