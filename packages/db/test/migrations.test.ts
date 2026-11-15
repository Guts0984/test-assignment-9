import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';
import { createTestDb, type TestDb } from '../src/testing';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

describe('migrations', () => {
  it('create every expected table', async () => {
    const r = await t.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const names = r.rows.map((x) => x.table_name);
    for (const expected of [
      'users',
      'sessions',
      'restaurant_tables',
      'dishes',
      'modifier_groups',
      'modifiers',
      'order_counters',
      'orders',
      'order_items',
      'order_item_modifiers',
      'payments',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('are safe to run again (idempotent)', async () => {
    await runMigrations(t.db);
    await runMigrations(t.db);
    const r = await t.db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(r.rows[0]?.n).toBeGreaterThan(0);
  });

  it('can be applied by two processes at once without corrupting the schema', async () => {
    const other = await createTestDb();
    try {
      await Promise.all([runMigrations(other.db), runMigrations(other.db)]);
      const r = await other.db.execute<{ n: number }>(
        sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
      );
      expect(r.rows[0]?.n).toBeGreaterThanOrEqual(11);
    } finally {
      await other.drop();
    }
  });

  it('keep money columns integer (no floats, no numeric)', async () => {
    const r = await t.db.execute<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(sql`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public'
        and column_name in ('price','surcharge','amount','tendered','change','total','subtotal','service_fee','unit_price','stock')
    `);
    expect(r.rows.length).toBeGreaterThan(8);
    for (const row of r.rows)
      expect(row.data_type, `${row.table_name}.${row.column_name}`).toBe('integer');
  });
});
