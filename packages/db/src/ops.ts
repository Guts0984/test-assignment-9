import { and, eq, isNull, or, gte, sql } from 'drizzle-orm';
import type { Queryable } from './client';
import { dishes, orderCounters } from './schema';

export const nextOrderNumber = async (tx: Queryable, day: string): Promise<number> => {
  const [row] = await tx
    .insert(orderCounters)
    .values({ day, last: 1 })
    .onConflictDoUpdate({
      target: orderCounters.day,
      set: { last: sql`${orderCounters.last} + 1` },
    })
    .returning({ last: orderCounters.last });
  if (!row) throw new Error('order counter upsert returned no row');
  return row.last;
};

/**
 * Atomically takes `qty` portions. One statement: the check and the decrement cannot be split, so
 * two concurrent callers for the last portion cannot both succeed.
 * Returns the remaining stock (null = unlimited), or `undefined` when there is not enough.
 */
export const takeStock = async (
  tx: Queryable,
  dishId: string,
  qty: number,
): Promise<{ stock: number | null } | undefined> => {
  if (!Number.isInteger(qty) || qty < 1) throw new RangeError('qty must be an integer >= 1');
  const [row] = await tx
    .update(dishes)
    .set({
      stock: sql`case when ${dishes.stock} is null then null else ${dishes.stock} - ${qty} end`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(dishes.id, dishId),
        eq(dishes.archived, false),
        or(isNull(dishes.stock), gte(dishes.stock, qty)),
      ),
    )
    .returning({ stock: dishes.stock });
  return row;
};

/** Gives `qty` portions back (cancelled item). Unlimited dishes (NULL stock) are left alone. */
export const returnStock = async (
  tx: Queryable,
  dishId: string,
  qty: number,
): Promise<{ stock: number | null } | undefined> => {
  if (!Number.isInteger(qty) || qty < 1) throw new RangeError('qty must be an integer >= 1');
  const [row] = await tx
    .update(dishes)
    .set({
      stock: sql`case when ${dishes.stock} is null then null else ${dishes.stock} + ${qty} end`,
      updatedAt: sql`now()`,
    })
    .where(eq(dishes.id, dishId))
    .returning({ stock: dishes.stock });
  return row;
};
