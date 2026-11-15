import { expect } from 'vitest';
import type { Db } from '../src/client';
import { dishes, orderItems, orders, restaurantTables, users } from '../src/schema';

/** Digs the Postgres error out of drizzle's wrapper. */
const pgError = (err: unknown): { code?: string; constraint?: string; message: string } => {
  const e = err as { cause?: unknown; code?: string; constraint?: string; message?: string };
  if (e && typeof e === 'object' && e.cause && typeof e.cause === 'object') {
    return pgError(e.cause);
  }
  return { code: e?.code, constraint: e?.constraint, message: String(e?.message ?? err) };
};

/** Asserts that a query is rejected by the database with the given constraint name. */
export const expectViolation = async (p: Promise<unknown>, constraint: string): Promise<void> => {
  let caught: unknown;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected constraint "${constraint}" to reject the statement`).toBeDefined();
  const e = pgError(caught);
  expect(e.constraint ?? e.message).toBe(constraint);
};

export const makeUser = async (
  db: Db,
  username = 'waiter1',
  role: 'waiter' | 'cook' | 'manager' = 'waiter',
) => {
  const [u] = await db
    .insert(users)
    .values({ username, displayName: username, passwordHash: 'x', role })
    .returning();
  return u!;
};

let tableNumber = 0;
export const makeTable = async (db: Db, seats = 4) => {
  const [t] = await db
    .insert(restaurantTables)
    .values({ number: ++tableNumber, seats })
    .returning();
  return t!;
};

export const makeDish = async (db: Db, over: Partial<typeof dishes.$inferInsert> = {}) => {
  const [d] = await db
    .insert(dishes)
    .values({ name: 'Dish', category: 'Mains', price: 10000, station: 'kitchen', ...over })
    .returning();
  return d!;
};

let orderNumber = 1000;
export const makeOrder = async (
  db: Db,
  base: { tableId: string; waiterId: string },
  over: Partial<typeof orders.$inferInsert> = {},
) => {
  const [o] = await db
    .insert(orders)
    .values({ number: ++orderNumber, day: '2025-01-15', guests: 2, ...base, ...over })
    .returning();
  return o!;
};

export const makeItem = async (
  db: Db,
  base: { orderId: string; dishId: string },
  over: Partial<typeof orderItems.$inferInsert> = {},
) => {
  const [i] = await db
    .insert(orderItems)
    .values({
      dishName: 'Dish',
      station: 'kitchen',
      unitPrice: 10000,
      guest: 1,
      ...base,
      ...over,
    })
    .returning();
  return i!;
};
