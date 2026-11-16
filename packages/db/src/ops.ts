import { and, eq, isNotNull, isNull, or, gte, sql } from 'drizzle-orm';
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
 * Returns the remaining stock (null = unlimited) and the stock epoch the portions were taken under,
 * or `undefined` when there is not enough.
 */
export const takeStock = async (
  tx: Queryable,
  dishId: string,
  qty: number,
): Promise<{ stock: number | null; epoch: number } | undefined> => {
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
    .returning({ stock: dishes.stock, epoch: dishes.stockEpoch });
  return row;
};

/**
 * Gives `qty` portions back (cancelled item) — but only if they were really taken (`epoch` is not null),
 * the dish is still limited, and nobody has set the stock by hand since (same epoch). Otherwise nothing
 * changes: a manager's stop-list stays, and an unlimited dish never grows a stock number.
 * Returns the new stock, or `undefined` when nothing was returned.
 */
export const returnStock = async (
  tx: Queryable,
  dishId: string,
  qty: number,
  epoch: number | null,
): Promise<{ stock: number } | undefined> => {
  if (!Number.isInteger(qty) || qty < 1) throw new RangeError('qty must be an integer >= 1');
  if (epoch === null) return undefined;
  const [row] = await tx
    .update(dishes)
    .set({ stock: sql`${dishes.stock} + ${qty}`, updatedAt: sql`now()` })
    .where(and(eq(dishes.id, dishId), isNotNull(dishes.stock), eq(dishes.stockEpoch, epoch)))
    .returning({ stock: dishes.stock });
  return row ? { stock: row.stock ?? 0 } : undefined;
};
