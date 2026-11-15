import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, type DbHandle } from './client';
import { runMigrations } from './migrate';

export type TestDb = DbHandle & { url: string; name: string; drop: () => Promise<void> };

/**
 * Creates a brand-new, fully migrated database on the server in TEST_DATABASE_URL.
 * Every test file gets its own, so tests never see each other's data. Drop it in afterAll.
 */
export const createTestDb = async (options: { max?: number } = {}): Promise<TestDb> => {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Start Postgres (`docker compose up -d postgres`) and set it in .env.',
    );
  }
  const name = `test_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const handle = createDb(url.toString(), { max: options.max ?? 10, applicationName: 'test' });
  await runMigrations(handle.db);

  const drop = async (): Promise<void> => {
    await handle.close();
    const a = new pg.Client({ connectionString: adminUrl });
    await a.connect();
    try {
      await a.query(`drop database if exists "${name}" with (force)`);
    } finally {
      await a.end();
    }
  };
  return { ...handle, url: url.toString(), name, drop };
};
