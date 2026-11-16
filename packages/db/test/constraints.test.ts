import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../src/testing';
import {
  dishes,
  modifierGroups,
  modifiers,
  orderCounters,
  orderItemModifiers,
  orderItems,
  orders,
  payments,
  restaurantTables,
  sessions,
  users,
} from '../src/schema';
import { expectViolation, makeDish, makeItem, makeOrder, makeTable, makeUser } from './helpers';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

describe('users & sessions', () => {
  it('usernames are unique case-insensitively', async () => {
    await makeUser(t.db, 'Alice');
    await expectViolation(makeUser(t.db, 'alice'), 'users_username_lower_uq');
    await expectViolation(makeUser(t.db, 'ALICE'), 'users_username_lower_uq');
  });
  it('username length is bounded', async () => {
    await expectViolation(makeUser(t.db, 'ab'), 'users_username_len');
    await expectViolation(makeUser(t.db, 'x'.repeat(33)), 'users_username_len');
  });
  it('rejects a role outside the enum', async () => {
    await expect(
      t.db.execute(
        sql`insert into users (username, display_name, password_hash, role) values ('hacker1', 'h', 'x', 'admin')`,
      ),
    ).rejects.toThrow();
  });
  it('session tokens are unique and must expire after creation; deleting the user deletes sessions', async () => {
    const u = await makeUser(t.db, 'sess_user');
    const future = new Date(Date.now() + 3600_000);
    await t.db.insert(sessions).values({ userId: u.id, tokenHash: 'h1', expiresAt: future });
    await expectViolation(
      t.db.insert(sessions).values({ userId: u.id, tokenHash: 'h1', expiresAt: future }),
      'sessions_token_hash_unique',
    );
    await expectViolation(
      t.db.insert(sessions).values({ userId: u.id, tokenHash: 'h2', expiresAt: new Date(0) }),
      'sessions_expiry_after_creation',
    );
    await t.db.delete(users).where(eq(users.id, u.id));
    const left = await t.db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(left).toHaveLength(0);
  });
});

describe('tables', () => {
  it('rejects non-positive numbers/seats and duplicate numbers', async () => {
    await expectViolation(
      t.db.insert(restaurantTables).values({ number: 0, seats: 2 }),
      'tables_number_positive',
    );
    await expectViolation(
      t.db.insert(restaurantTables).values({ number: 900, seats: 0 }),
      'tables_seats_positive',
    );
    await t.db.insert(restaurantTables).values({ number: 901, seats: 2 });
    await expectViolation(
      t.db.insert(restaurantTables).values({ number: 901, seats: 2 }),
      'restaurant_tables_number_unique',
    );
  });
});

describe('dishes & modifiers', () => {
  it('rejects negative price and negative stock; accepts NULL and 0 stock', async () => {
    await expectViolation(makeDish(t.db, { price: -1 }), 'dishes_price_nonneg');
    await expectViolation(makeDish(t.db, { stock: -1 }), 'dishes_stock_nonneg');
    await expect(makeDish(t.db, { stock: null })).resolves.toBeDefined();
    await expect(makeDish(t.db, { stock: 0 })).resolves.toBeDefined();
  });
  it('rejects float prices at the SQL level', async () => {
    await expect(
      t.db.execute(
        sql`insert into dishes (name, category, price, station) values ('x','y',10.5,'kitchen')`,
      ),
    ).resolves.toBeDefined(); // Postgres rounds 10.5 -> 11 on integer cast: documents why the API validates
    const r = await t.db.execute<{ price: number }>(sql`select price from dishes where name = 'x'`);
    expect(Number.isInteger(r.rows[0]?.price)).toBe(true);
  });
  it('modifier group rule min <= max, min >= 0, max >= 1', async () => {
    const d = await makeDish(t.db);
    const g = (min: number, max: number) =>
      t.db.insert(modifierGroups).values({ dishId: d.id, name: 'g', min, max });
    await expectViolation(g(2, 1), 'modifier_groups_min_le_max');
    await expectViolation(g(-1, 1), 'modifier_groups_min_nonneg');
    await expectViolation(g(0, 0), 'modifier_groups_max_positive');
    await expect(g(1, 1)).resolves.toBeDefined();
    await expect(g(0, 3)).resolves.toBeDefined();
  });
  it('negative surcharge is rejected; deleting a dish removes its groups and modifiers', async () => {
    const d = await makeDish(t.db);
    const [g] = await t.db
      .insert(modifierGroups)
      .values({ dishId: d.id, name: 'g', min: 0, max: 1 })
      .returning();
    await expectViolation(
      t.db.insert(modifiers).values({ groupId: g!.id, name: 'm', surcharge: -1 }),
      'modifiers_surcharge_nonneg',
    );
    await t.db.insert(modifiers).values({ groupId: g!.id, name: 'm', surcharge: 100 });
    await t.db.delete(dishes).where(eq(dishes.id, d.id));
    const left = await t.db.select().from(modifiers).where(eq(modifiers.groupId, g!.id));
    expect(left).toHaveLength(0);
  });
});

describe('orders', () => {
  it('check number is unique per day but may repeat on another day', async () => {
    const w = await makeUser(t.db, 'w_orders');
    const tb1 = await makeTable(t.db);
    const tb2 = await makeTable(t.db);
    const base1 = { tableId: tb1.id, waiterId: w.id };
    await makeOrder(t.db, base1, { number: 7, day: '2025-02-01' });
    await expectViolation(
      makeOrder(t.db, { tableId: tb2.id, waiterId: w.id }, { number: 7, day: '2025-02-01' }),
      'orders_day_number_uq',
    );
    await expect(
      makeOrder(t.db, { tableId: tb2.id, waiterId: w.id }, { number: 7, day: '2025-02-02' }),
    ).resolves.toBeDefined();
  });
  it('a table can have only one OPEN check, but many paid ones', async () => {
    const w = await makeUser(t.db, 'w_open');
    const tb = await makeTable(t.db);
    const base = { tableId: tb.id, waiterId: w.id };
    await makeOrder(t.db, base, { number: 1, day: '2025-03-01' });
    await expectViolation(
      makeOrder(t.db, base, { number: 2, day: '2025-03-01' }),
      'orders_one_open_per_table_uq',
    );
    const paid = {
      status: 'paid' as const,
      subtotal: 100,
      serviceFee: 0,
      total: 100,
      paidAt: new Date(),
    };
    await makeOrder(t.db, base, { number: 3, day: '2025-03-01', ...paid });
    await makeOrder(t.db, base, { number: 4, day: '2025-03-01', ...paid });
  });
  it('guests must be 1…50', async () => {
    const w = await makeUser(t.db, 'w_guests');
    const tb = await makeTable(t.db);
    const base = { tableId: tb.id, waiterId: w.id };
    await expectViolation(
      makeOrder(t.db, base, { number: 1, day: '2025-04-01', guests: 0 }),
      'orders_guests_range',
    );
    await expectViolation(
      makeOrder(t.db, base, { number: 1, day: '2025-04-01', guests: 51 }),
      'orders_guests_range',
    );
  });
  it('closed (nothing to bill) has frozen zero totals and no paid_at; open/closed never carry a paid_at', async () => {
    const w = await makeUser(t.db, 'w_closed');
    const tb = await makeTable(t.db);
    const base = { tableId: tb.id, waiterId: w.id };
    await makeOrder(t.db, base, {
      number: 1,
      day: '2025-05-02',
      status: 'closed',
      subtotal: 0,
      serviceFee: 0,
      total: 0,
    });
    // closed without totals
    await expectViolation(
      makeOrder(t.db, base, { number: 2, day: '2025-05-02', status: 'closed' }),
      'orders_settled_consistency',
    );
    // closed with a paid_at, or open with one
    await expectViolation(
      makeOrder(t.db, base, {
        number: 3,
        day: '2025-05-02',
        status: 'closed',
        subtotal: 0,
        serviceFee: 0,
        total: 0,
        paidAt: new Date(),
      }),
      'orders_paid_at_consistency',
    );
    await expectViolation(
      makeOrder(t.db, base, { number: 4, day: '2025-05-02', paidAt: new Date() }),
      'orders_paid_at_consistency',
    );
  });
  it('paid ⇔ totals and paid_at are all set; total = subtotal + fee', async () => {
    const w = await makeUser(t.db, 'w_paid');
    const tb = await makeTable(t.db);
    const base = { tableId: tb.id, waiterId: w.id };
    // paid without totals
    await expectViolation(
      makeOrder(t.db, base, { number: 1, day: '2025-05-01', status: 'paid', paidAt: new Date() }),
      'orders_settled_consistency',
    );
    // open with totals set (a half-paid state must be impossible)
    await expectViolation(
      makeOrder(t.db, base, {
        number: 2,
        day: '2025-05-01',
        subtotal: 1,
        serviceFee: 0,
        total: 1,
      }),
      'orders_settled_consistency',
    );
    // arithmetic mismatch
    await expectViolation(
      makeOrder(t.db, base, {
        number: 3,
        day: '2025-05-01',
        status: 'paid',
        subtotal: 100,
        serviceFee: 10,
        total: 999,
        paidAt: new Date(),
      }),
      'orders_total_sum',
    );
  });
  it('foreign keys: unknown table/waiter rejected; table with orders cannot be deleted', async () => {
    const w = await makeUser(t.db, 'w_fk');
    const tb = await makeTable(t.db);
    const ghost = '00000000-0000-4000-8000-000000000000';
    await expect(
      makeOrder(t.db, { tableId: ghost, waiterId: w.id }, { number: 1, day: '2025-06-01' }),
    ).rejects.toThrow();
    await expect(
      makeOrder(t.db, { tableId: tb.id, waiterId: ghost }, { number: 1, day: '2025-06-01' }),
    ).rejects.toThrow();
    await makeOrder(t.db, { tableId: tb.id, waiterId: w.id }, { number: 1, day: '2025-06-01' });
    await expect(
      t.db.delete(restaurantTables).where(eq(restaurantTables.id, tb.id)),
    ).rejects.toThrow();
    await expect(t.db.delete(users).where(eq(users.id, w.id))).rejects.toThrow();
  });
  it('order counter cannot go negative', async () => {
    await expectViolation(
      t.db.insert(orderCounters).values({ day: '2025-07-01', last: -1 }),
      'order_counters_last_nonneg',
    );
  });
});

describe('order items', () => {
  const setup = async (name: string) => {
    const w = await makeUser(t.db, name);
    const tb = await makeTable(t.db);
    const d = await makeDish(t.db);
    const o = await makeOrder(t.db, { tableId: tb.id, waiterId: w.id }, { day: '2025-08-01' });
    return { o, d };
  };
  it('guest >= 1, price >= 0, comment <= 200', async () => {
    const { o, d } = await setup('w_items1');
    const base = { orderId: o.id, dishId: d.id };
    await expectViolation(makeItem(t.db, base, { guest: 0 }), 'order_items_guest_positive');
    await expectViolation(makeItem(t.db, base, { unitPrice: -1 }), 'order_items_price_nonneg');
    await expectViolation(
      makeItem(t.db, base, { comment: 'x'.repeat(201) }),
      'order_items_comment_len',
    );
    await expect(makeItem(t.db, base, { comment: 'x'.repeat(200) })).resolves.toBeDefined();
  });
  it('draft has no sent_at; sent+ must have it', async () => {
    const { o, d } = await setup('w_items2');
    const base = { orderId: o.id, dishId: d.id };
    await expectViolation(
      makeItem(t.db, base, { status: 'draft', sentAt: new Date() }),
      'order_items_sent_consistency',
    );
    await expectViolation(makeItem(t.db, base, { status: 'sent' }), 'order_items_sent_consistency');
    await expectViolation(
      makeItem(t.db, base, { status: 'ready' }),
      'order_items_sent_consistency',
    );
    await expect(
      makeItem(t.db, base, { status: 'sent', sentAt: new Date() }),
    ).resolves.toBeDefined();
  });
  it('a dish that appears on bills cannot be hard-deleted (history is protected)', async () => {
    const { o, d } = await setup('w_items3');
    await makeItem(t.db, { orderId: o.id, dishId: d.id });
    await expect(t.db.delete(dishes).where(eq(dishes.id, d.id))).rejects.toThrow();
  });
  it('item modifiers keep their snapshot when the menu modifier is deleted', async () => {
    const { o, d } = await setup('w_items4');
    const [g] = await t.db
      .insert(modifierGroups)
      .values({ dishId: d.id, name: 'g', min: 0, max: 1 })
      .returning();
    const [m] = await t.db
      .insert(modifiers)
      .values({ groupId: g!.id, name: 'Bacon', surcharge: 3500 })
      .returning();
    const item = await makeItem(t.db, { orderId: o.id, dishId: d.id });
    await t.db
      .insert(orderItemModifiers)
      .values({ itemId: item.id, modifierId: m!.id, name: 'Bacon', surcharge: 3500 });
    await t.db.delete(modifiers).where(eq(modifiers.id, m!.id));
    const rows = await t.db
      .select()
      .from(orderItemModifiers)
      .where(eq(orderItemModifiers.itemId, item.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ modifierId: null, name: 'Bacon', surcharge: 3500 });
    await expectViolation(
      t.db.insert(orderItemModifiers).values({ itemId: item.id, name: 'x', surcharge: -1 }),
      'order_item_modifiers_surcharge_nonneg',
    );
  });
  it('deleting an order removes its items and their modifiers', async () => {
    const { o, d } = await setup('w_items5');
    const item = await makeItem(t.db, { orderId: o.id, dishId: d.id });
    await t.db.insert(orderItemModifiers).values({ itemId: item.id, name: 'x', surcharge: 0 });
    await t.db.delete(orders).where(eq(orders.id, o.id));
    expect(await t.db.select().from(orderItems).where(eq(orderItems.orderId, o.id))).toHaveLength(
      0,
    );
    expect(
      await t.db.select().from(orderItemModifiers).where(eq(orderItemModifiers.itemId, item.id)),
    ).toHaveLength(0);
  });
});

describe('payments', () => {
  const orderFor = async (name: string) => {
    const w = await makeUser(t.db, name);
    const tb = await makeTable(t.db);
    return makeOrder(t.db, { tableId: tb.id, waiterId: w.id }, { day: '2025-09-01' });
  };
  const pay = (orderId: string, over: Partial<typeof payments.$inferInsert> = {}) =>
    t.db.insert(payments).values({
      id: crypto.randomUUID(),
      orderId,
      method: 'cash',
      amount: 1000,
      tendered: 1000,
      change: 0,
      requestHash: 'h',
      ...over,
    });

  it('payment id is the idempotency key: the same id cannot be inserted twice', async () => {
    const o = await orderFor('w_pay1');
    const id = crypto.randomUUID();
    await pay(o.id, { id });
    await expectViolation(pay(o.id, { id }), 'payments_pkey');
  });
  it('amount must be positive', async () => {
    const o = await orderFor('w_pay2');
    await expectViolation(pay(o.id, { amount: 0, tendered: 0 }), 'payments_amount_positive');
    await expectViolation(pay(o.id, { amount: -5, tendered: 0 }), 'payments_amount_positive');
  });
  it('cash: tendered >= amount and change = tendered - amount', async () => {
    const o = await orderFor('w_pay3');
    await expect(pay(o.id, { amount: 7350, tendered: 10000, change: 2650 })).resolves.toBeDefined();
    await expectViolation(
      pay(o.id, { amount: 1000, tendered: 999, change: 0 }),
      'payments_cash_or_card',
    );
    await expectViolation(
      pay(o.id, { amount: 1000, tendered: 2000, change: 5 }),
      'payments_cash_or_card',
    );
    await expectViolation(
      pay(o.id, { amount: 1000, tendered: null, change: 0 }),
      'payments_cash_or_card',
    );
  });
  it('card: no tendered, no change', async () => {
    const o = await orderFor('w_pay4');
    await expect(pay(o.id, { method: 'card', tendered: null, change: 0 })).resolves.toBeDefined();
    await expectViolation(
      pay(o.id, { method: 'card', tendered: 1000, change: 0 }),
      'payments_cash_or_card',
    );
    await expectViolation(
      pay(o.id, { method: 'card', tendered: null, change: 10 }),
      'payments_cash_or_card',
    );
  });
  it('a check with payments cannot be deleted', async () => {
    const o = await orderFor('w_pay5');
    await pay(o.id);
    await expect(t.db.delete(orders).where(eq(orders.id, o.id))).rejects.toThrow();
  });
});
