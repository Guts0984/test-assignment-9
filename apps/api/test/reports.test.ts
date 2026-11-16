import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addDays, businessDayOf, type RevenueResponse } from '@app/shared';
import { PASSWORDS, startTestApp, type TestApp } from './harness';
import { as, type Client } from './world';

let app: TestApp;
let manager: Client;
let waiter: Client;
let cook: Client;
const today = businessDayOf(new Date(), 'Europe/Kyiv', 4);
const FROM = addDays(today, -60);
const TO = addDays(today, -1);

beforeAll(async () => {
  // The complete reference seed: 20 tables, 60 dishes, 60 days of history.
  app = await startTestApp(
    { RATE_LIMIT_ENABLED: 'false', LOGIN_MAX_CONCURRENCY: '32' },
    { fullSeed: true },
  );
  manager = as(app, await app.login('manager', PASSWORDS.manager));
  waiter = as(app, await app.login('waiter1', PASSWORDS.waiter1));
  cook = as(app, await app.login('cook1', PASSWORDS.cook1));
  await app.db.execute(sql`analyze`);
});
afterAll(async () => {
  await app.close();
});

describe('seeded restaurant, as seen through the API', () => {
  it('the menu has 60 dishes; limited dishes show their stock', async () => {
    const dishes = (await waiter.get('/menu')).body.dishes as {
      name: string;
      stock: number | null;
    }[];
    expect(dishes).toHaveLength(60);
    expect(dishes.find((d) => d.name === 'Lamb chops')!.stock).toBe(5);
  });
  it('20 tables; the demo open checks show free / occupied / ready', async () => {
    const tables = (await waiter.get('/tables')).body.tables as { number: number; state: string }[];
    expect(tables).toHaveLength(20);
    expect(tables.slice(0, 5).map((t) => t.state)).toEqual([
      'ready',
      'occupied',
      'ready',
      'occupied',
      'occupied',
    ]);
    expect(tables.slice(5).every((t) => t.state === 'free')).toBe(true);
  });
  it('the kitchen already has today’s sent and cooking items', async () => {
    const items = (await cook.get('/kitchen')).body.items as { status: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.status === 'sent' || i.status === 'cooking')).toBe(true);
  });
});

describe('GET /reports/revenue', () => {
  it('60 days of revenue and the top dishes, consistent with the database', async () => {
    const r = await manager.get(`/reports/revenue?from=${FROM}&to=${TO}`);
    expect(r.status).toBe(200);
    const rep = r.body as RevenueResponse;
    expect(rep.days).toHaveLength(60);
    expect(rep.topDishes).toHaveLength(10);
    const raw = await app.db.execute<{ t: string; n: string }>(
      sql`select sum(total)::text as t, count(*)::text as n from orders where status = 'paid'`,
    );
    expect(rep.total).toBe(Number(raw.rows[0]!.t));
    expect(rep.orders).toBe(Number(raw.rows[0]!.n));
    expect(rep.days.reduce((a, d) => a + d.revenue, 0)).toBe(rep.total);
    expect(Number.isInteger(rep.total)).toBe(true);
  });
  it('shorter periods work: one day, a week', async () => {
    const one = (await manager.get(`/reports/revenue?from=${TO}&to=${TO}`)).body as RevenueResponse;
    expect(one.days).toHaveLength(1);
    const week = (await manager.get(`/reports/revenue?from=${addDays(today, -7)}&to=${TO}`))
      .body as RevenueResponse;
    expect(week.days).toHaveLength(7);
  });
  it('rejects bad periods: > 60 days, reversed, impossible dates, missing, extra or repeated params', async () => {
    for (const q of [
      `from=${addDays(today, -61)}&to=${TO}`,
      `from=${TO}&to=${FROM}`,
      'from=2025-02-30&to=2025-03-01',
      'from=2025-13-01&to=2025-13-02',
      'from=yesterday&to=today',
      `from=${FROM}`,
      '',
      `from=${FROM}&to=${TO}&limit=5`,
      `from=${FROM}&from=${FROM}&to=${TO}`,
      `from[]=${FROM}&to=${TO}`,
      `from=${FROM}%27%3B%20drop%20table%20orders%3B--&to=${TO}`,
    ]) {
      const r = await manager.get(`/reports/revenue?${q}`);
      expect(r.status, q).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_FAILED');
    }
  });
  it('only managers may read it', async () => {
    expect((await waiter.get(`/reports/revenue?from=${FROM}&to=${TO}`)).status).toBe(403);
    expect((await cook.get(`/reports/revenue?from=${FROM}&to=${TO}`)).status).toBe(403);
    expect((await app.call({ path: `/reports/revenue?from=${FROM}&to=${TO}` })).status).toBe(401);
  });
});
