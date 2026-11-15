import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, dayOf, RevenueQuery, RevenueResponse } from '@app/shared';
import { revenueReport } from '../src/report';
import { seedDatabase } from '../src/seed';
import { createTestDb, type TestDb } from '../src/testing';

const TZ = 'Europe/Kyiv';
const NOW = new Date('2025-06-15T09:30:00Z');
const TODAY = dayOf(NOW, TZ);
const FROM = addDays(TODAY, -60);
const TO = addDays(TODAY, -1);

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, {
    tz: TZ,
    now: NOW,
    passwords: { waiter: 'waiter-test-pw', cook: 'cook-test-pw', manager: 'manager-test-pw' },
  });
  await t.db.execute(sql`analyze`);
});
afterAll(async () => {
  await t.drop();
});

describe('revenueReport', () => {
  it('returns a response that matches the shared schema and the 60-day query rules', async () => {
    expect(RevenueQuery.safeParse({ from: FROM, to: TO }).success).toBe(true);
    const r = await revenueReport(t.db, FROM, TO);
    expect(RevenueResponse.safeParse(r).success).toBe(true);
    expect(r.days).toHaveLength(60);
  });

  it('total equals an independent sum of the paid checks', async () => {
    const r = await revenueReport(t.db, FROM, TO);
    const raw = await t.db.execute<{ total: string; n: string }>(
      sql`select sum(total)::text as total, count(*)::text as n from orders where status = 'paid'`,
    );
    expect(r.total).toBe(Number(raw.rows[0]?.total));
    expect(r.orders).toBe(Number(raw.rows[0]?.n));
    expect(r.days.reduce((a, d) => a + d.revenue, 0)).toBe(r.total);
  });

  it('top dishes are ordered by revenue, exclude cancelled/draft items, and are at most 10', async () => {
    const r = await revenueReport(t.db, FROM, TO);
    expect(r.topDishes.length).toBe(10);
    for (let i = 1; i < r.topDishes.length; i++) {
      expect(r.topDishes[i]!.revenue).toBeLessThanOrEqual(r.topDishes[i - 1]!.revenue);
    }
    const top = r.topDishes[0]!;
    const raw = await t.db.execute<{ q: string; rev: string }>(sql`
      select count(*)::text as q, sum(oi.unit_price)::text as rev
      from order_items oi join orders o on o.id = oi.order_id
      where o.status = 'paid' and oi.dish_id = ${top.dishId} and oi.status in ('sent','cooking','ready','served')`);
    expect(top.quantity).toBe(Number(raw.rows[0]?.q));
    expect(top.revenue).toBe(Number(raw.rows[0]?.rev));
  });

  it('respects the period: a single day, a sub-range, and an empty range', async () => {
    const day = addDays(TODAY, -10);
    const one = await revenueReport(t.db, day, day);
    expect(one.days).toHaveLength(1);
    expect(one.total).toBe(one.days[0]!.revenue);
    const week = await revenueReport(t.db, addDays(TODAY, -7), addDays(TODAY, -1));
    expect(week.days).toHaveLength(7);
    const none = await revenueReport(t.db, addDays(TODAY, 5), addDays(TODAY, 9));
    expect(none).toMatchObject({ total: 0, orders: 0, days: [], topDishes: [] });
    const reversed = await revenueReport(t.db, TO, FROM);
    expect(reversed.total).toBe(0);
  });

  it('open checks (today) are not revenue', async () => {
    const r = await revenueReport(t.db, TODAY, TODAY);
    expect(r.total).toBe(0);
  });

  it('is safe against SQL injection through the date arguments', async () => {
    await expect(revenueReport(t.db, "2025-01-01'; drop table orders;--", TO)).rejects.toThrow();
    const still = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from orders`);
    expect(still.rows[0]!.n).toBeGreaterThan(1000);
  });

  it('60-day report is fast: every warm run is under 300 ms', async () => {
    await revenueReport(t.db, FROM, TO); // warm-up
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await revenueReport(t.db, FROM, TO);
      times.push(performance.now() - start);
    }
    expect(
      Math.max(...times),
      `timings: ${times.map((x) => x.toFixed(0)).join(', ')} ms`,
    ).toBeLessThan(300);
  });
});
