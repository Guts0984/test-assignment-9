import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, dayOf } from '@app/shared';
import { verifyPassword } from '../src/password';
import { seedDatabase, SEED_HISTORY_DAYS, type SeedOptions } from '../src/seed';
import { createTestDb, type TestDb } from '../src/testing';
import { dishes, orders, users } from '../src/schema';

const TZ = 'Europe/Kyiv';
const NOW = new Date('2025-06-15T09:30:00Z');
const TODAY = dayOf(NOW, TZ);
const options: SeedOptions = {
  tz: TZ,
  now: NOW,
  passwords: { waiter: 'waiter-test-pw', cook: 'cook-test-pw', manager: 'manager-test-pw' },
};

let t: TestDb;
let summary: Awaited<ReturnType<typeof seedDatabase>>;
beforeAll(async () => {
  t = await createTestDb();
  summary = await seedDatabase(t.db, options);
});
afterAll(async () => {
  await t.drop();
});

const rows = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.db.execute<T>(query)).rows;

describe('seed: reference data', () => {
  it('has the required amounts', async () => {
    expect(summary).toMatchObject({
      seeded: true,
      tables: 20,
      dishes: 60,
      users: 8,
      openOrders: 5,
    });
    const byRole = await rows<{ role: string; n: number }>(
      sql`select role::text, count(*)::int as n from users group by role order by role`,
    );
    expect(byRole).toEqual([
      { role: 'cook', n: 2 },
      { role: 'manager', n: 1 },
      { role: 'waiter', n: 5 },
    ]);
    const [{ n: tables }] = await rows<{ n: number }>(
      sql`select count(*)::int as n from restaurant_tables`,
    );
    expect(tables).toBe(20);
    const [{ n: dishCount }] = await rows<{ n: number }>(
      sql`select count(*)::int as n from dishes`,
    );
    expect(dishCount).toBe(60);
  });
  it('tables are numbered 1…20 with sane seat counts', async () => {
    const r = await rows<{ number: number; seats: number }>(
      sql`select number, seats from restaurant_tables order by number`,
    );
    expect(r.map((x) => x.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(r.every((x) => x.seats >= 2 && x.seats <= 8)).toBe(true);
  });
  it('dish names are unique, both stations and several categories exist, stock demo dishes exist', async () => {
    const r = await rows<{ name: string; category: string; station: string; stock: number | null }>(
      sql`select name, category, station::text, stock from dishes`,
    );
    expect(new Set(r.map((x) => x.name)).size).toBe(60);
    expect(new Set(r.map((x) => x.station))).toEqual(new Set(['kitchen', 'bar']));
    expect(new Set(r.map((x) => x.category)).size).toBeGreaterThanOrEqual(8);
    expect(r.filter((x) => x.stock !== null).length).toBeGreaterThanOrEqual(3);
    expect(r.find((x) => x.name === 'Lamb chops')?.stock).toBe(5);
  });
  it('has the modifier shapes from the brief: "exactly 1" and "0–3"', async () => {
    const r = await rows<{ min: number; max: number }>(
      sql`select distinct min, max from modifier_groups`,
    );
    expect(r).toContainEqual({ min: 1, max: 1 });
    expect(r).toContainEqual({ min: 0, max: 3 });
    const bad = await rows(sql`
      select g.id from modifier_groups g
      left join modifiers m on m.group_id = g.id group by g.id, g.max having count(m.id) < g.max`);
    expect(bad).toHaveLength(0);
  });
  it('demo accounts can log in with the configured passwords and not with others', async () => {
    const [w] = await t.db.select().from(users).where(eq(users.username, 'waiter1'));
    const [c] = await t.db.select().from(users).where(eq(users.username, 'cook2'));
    const [m] = await t.db.select().from(users).where(eq(users.username, 'manager'));
    expect(await verifyPassword('waiter-test-pw', w!.passwordHash)).toBe(true);
    expect(await verifyPassword('cook-test-pw', c!.passwordHash)).toBe(true);
    expect(await verifyPassword('manager-test-pw', m!.passwordHash)).toBe(true);
    expect(await verifyPassword('cook-test-pw', w!.passwordHash)).toBe(false);
    expect(w!.passwordHash).not.toContain('waiter-test-pw');
  });
});

describe('seed: 60 days of history', () => {
  it('covers exactly the previous 60 days with paid checks (today has only open ones)', async () => {
    const [r] = await rows<{ days: number; min: string; max: string }>(sql`
      select count(distinct day)::int as days, min(day)::text as min, max(day)::text as max
      from orders where status = 'paid'`);
    expect(r).toEqual({
      days: SEED_HISTORY_DAYS,
      min: addDays(TODAY, -SEED_HISTORY_DAYS),
      max: addDays(TODAY, -1),
    });
    const today = await t.db.select().from(orders).where(eq(orders.day, TODAY));
    expect(today).toHaveLength(5);
    expect(today.every((o) => o.status === 'open')).toBe(true);
  });
  it('check numbers per day are 1..N without gaps or repeats, and counters agree', async () => {
    const bad = await rows(sql`
      select day from orders group by day
      having min(number) <> 1 or max(number) <> count(*) or count(distinct number) <> count(*)`);
    expect(bad).toHaveLength(0);
    const mismatch = await rows(sql`
      select o.day from (select day, max(number) as m from orders group by day) o
      left join order_counters c on c.day = o.day where c.last is distinct from o.m`);
    expect(mismatch).toHaveLength(0);
  });
  it('volume is realistic for the report benchmark', async () => {
    const [r] = await rows<{ orders: number; items: number }>(sql`
      select (select count(*) from orders)::int as orders, (select count(*) from order_items)::int as items`);
    expect(r!.orders).toBeGreaterThan(1500);
    expect(r!.items).toBeGreaterThan(5000);
  });
  it('every paid total = subtotal + fee and subtotal = Σ billable items', async () => {
    const bad = await rows(sql`
      select o.id from orders o
      left join (select order_id, sum(unit_price) as s from order_items
                 where status in ('sent','cooking','ready','served') group by order_id) i on i.order_id = o.id
      where o.status = 'paid' and (o.total <> o.subtotal + o.service_fee or o.subtotal <> coalesce(i.s, 0))`);
    expect(bad).toHaveLength(0);
  });
  it('service fee is 10% rounded half up for 6+ guests and zero otherwise', async () => {
    const bad = await rows(sql`
      select id from orders where status = 'paid' and service_fee <>
        case when guests >= 6 then (subtotal * 10 + 50) / 100 else 0 end`);
    expect(bad).toHaveLength(0);
    const [r] = await rows<{ withFee: number; without: number }>(sql`
      select count(*) filter (where guests >= 6)::int as "withFee", count(*) filter (where guests < 6)::int as without
      from orders where status = 'paid'`);
    expect(r!.withFee).toBeGreaterThan(50);
    expect(r!.without).toBeGreaterThan(500);
  });
  it('payments add up to the total, to the kopeck, on every paid check', async () => {
    const bad = await rows(sql`
      select o.id from orders o
      left join (select order_id, sum(amount) as s from payments group by order_id) p on p.order_id = o.id
      where o.status = 'paid' and o.total <> coalesce(p.s, -1)`);
    expect(bad).toHaveLength(0);
    const [r] = await rows<{ multi: number; cash: number; card: number }>(sql`
      select (select count(*) from (select order_id from payments group by order_id having count(*) > 1) x)::int as multi,
             (select count(*) from payments where method = 'cash')::int as cash,
             (select count(*) from payments where method = 'card')::int as card`);
    expect(r!.multi).toBeGreaterThan(100); // split payments exist
    expect(r!.cash).toBeGreaterThan(100);
    expect(r!.card).toBeGreaterThan(100);
  });
  it('unit price = dish price + Σ modifier surcharges (prices frozen on the item)', async () => {
    const bad = await rows(sql`
      select oi.id from order_items oi
      join dishes d on d.id = oi.dish_id
      left join (select item_id, sum(surcharge) as s from order_item_modifiers group by item_id) m on m.item_id = oi.id
      where oi.unit_price <> d.price + coalesce(m.s, 0)`);
    expect(bad).toHaveLength(0);
  });
  it('every item respects its dish modifier rules (min…max per group)', async () => {
    const bad = await rows(sql`
      select oi.id, g.id as group_id from order_items oi
      join modifier_groups g on g.dish_id = oi.dish_id
      left join (
        select oim.item_id, m.group_id, count(*) as c
        from order_item_modifiers oim join modifiers m on m.id = oim.modifier_id
        group by oim.item_id, m.group_id
      ) s on s.item_id = oi.id and s.group_id = g.id
      where coalesce(s.c, 0) < g.min or coalesce(s.c, 0) > g.max`);
    expect(bad).toHaveLength(0);
  });
  it('item timeline is ordered and checks are opened in the right business day', async () => {
    const bad = await rows(sql`
      select oi.id from order_items oi
      where (cooking_at is not null and cooking_at < sent_at)
         or (ready_at is not null and ready_at < cooking_at)
         or (served_at is not null and served_at < ready_at)`);
    expect(bad).toHaveLength(0);
    const wrongDay = await rows(sql`
      select id from orders where (created_at at time zone ${TZ})::date <> day`);
    expect(wrongDay).toHaveLength(0);
    const paidBeforeOpened = await rows(sql`select id from orders where paid_at <= created_at`);
    expect(paidBeforeOpened).toHaveLength(0);
  });
  it('paid checks have no draft items; cancelled items exist but are not billed', async () => {
    const [r] = await rows<{ drafts: number; cancelled: number }>(sql`
      select count(*) filter (where i.status = 'draft')::int as drafts,
             count(*) filter (where i.status = 'cancelled')::int as cancelled
      from order_items i join orders o on o.id = i.order_id where o.status = 'paid'`);
    expect(r!.drafts).toBe(0);
    expect(r!.cancelled).toBeGreaterThan(0);
  });
});

describe('seed: today (demo state)', () => {
  it('has open checks on distinct tables with items in every kitchen state', async () => {
    const tables = await rows<{ n: number }>(
      sql`select count(distinct table_id)::int as n from orders where status = 'open'`,
    );
    expect(tables[0]!.n).toBe(5);
    const st = await rows<{ status: string }>(
      sql`select distinct i.status::text as status from order_items i join orders o on o.id = i.order_id where o.status = 'open'`,
    );
    expect(new Set(st.map((x) => x.status))).toEqual(
      new Set(['draft', 'sent', 'cooking', 'ready', 'served']),
    );
  });
  it('open checks use unlimited dishes only, so stock levels are untouched', async () => {
    const lamb = await t.db.select().from(dishes).where(eq(dishes.name, 'Lamb chops'));
    expect(lamb[0]?.stock).toBe(5);
    const touched = await rows(sql`
      select 1 from order_items i join orders o on o.id = i.order_id
      join dishes d on d.id = i.dish_id where o.status = 'open' and d.stock is not null`);
    expect(touched).toHaveLength(0);
  });
});

describe('seed: idempotency and determinism', () => {
  const counts = async (db: TestDb['db']) => {
    const [r] = (
      await db.execute<{
        users: number;
        orders: number;
        items: number;
        payments: number;
        revenue: string;
      }>(sql`
        select (select count(*) from users)::int as users, (select count(*) from orders)::int as orders,
               (select count(*) from order_items)::int as items, (select count(*) from payments)::int as payments,
               (select coalesce(sum(total), 0) from orders)::text as revenue`)
    ).rows;
    return r!;
  };

  it('running the seed again changes nothing', async () => {
    const before = await counts(t.db);
    const again = await seedDatabase(t.db, options);
    expect(again.seeded).toBe(false);
    expect(await counts(t.db)).toEqual(before);
  });

  it('is deterministic: a second database seeded the same way is identical', async () => {
    const other = await createTestDb();
    try {
      await seedDatabase(other.db, options);
      expect(await counts(other.db)).toEqual(await counts(t.db));
    } finally {
      await other.drop();
    }
  });

  it('reset wipes and reseeds to the same state; it also clears sessions', async () => {
    const other = await createTestDb();
    try {
      await seedDatabase(other.db, options);
      const [u] = await other.db.select().from(users).limit(1);
      await other.db.execute(
        sql`insert into sessions (user_id, token_hash, expires_at) values (${u!.id}, 'tok', now() + interval '1 hour')`,
      );
      const before = await counts(other.db);
      const res = await seedDatabase(other.db, { ...options, reset: true });
      expect(res.seeded).toBe(true);
      expect(await counts(other.db)).toEqual(before);
      const s = await other.db.execute<{ n: number }>(sql`select count(*)::int as n from sessions`);
      expect(s.rows[0]?.n).toBe(0);
    } finally {
      await other.drop();
    }
  });

  it('a failure halfway leaves the database empty (single transaction)', async () => {
    const other = await createTestDb();
    try {
      // Pre-insert a table row that collides with the seed's table number 1 inside the transaction.
      await other.db.execute(sql`insert into restaurant_tables (number, seats) values (1, 2)`);
      await expect(seedDatabase(other.db, options)).rejects.toThrow();
      const [r] = (
        await other.db.execute<{ users: number; dishes: number }>(
          sql`select (select count(*) from users)::int as users, (select count(*) from dishes)::int as dishes`,
        )
      ).rows;
      expect(r).toEqual({ users: 0, dishes: 0 });
    } finally {
      await other.drop();
    }
  });
});
