import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../src/testing';
import { nextOrderNumber, returnStock, takeStock } from '../src/ops';
import { dishes, orderCounters, orders } from '../src/schema';
import { makeDish, makeTable, makeUser } from './helpers';

let t: TestDb;
beforeAll(async () => {
  // A small pool on purpose: far more concurrent callers than connections.
  t = await createTestDb({ max: 20 });
});
afterAll(async () => {
  await t.drop();
});

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('nextOrderNumber (gapless daily numbering)', () => {
  it('starts at 1 and counts up per day independently', async () => {
    expect(await nextOrderNumber(t.db, '2030-01-01')).toBe(1);
    expect(await nextOrderNumber(t.db, '2030-01-01')).toBe(2);
    expect(await nextOrderNumber(t.db, '2030-01-02')).toBe(1);
    expect(await nextOrderNumber(t.db, '2030-01-01')).toBe(3);
  });

  const openOrderTx = async (day: string, waiterId: string, tableId: string, failAfter = false) =>
    t.db.transaction(async (tx) => {
      const number = await nextOrderNumber(tx, day);
      await tx.insert(orders).values({ number, day, tableId, waiterId, guests: 2 });
      if (failAfter) throw new Error('simulated failure after taking a number');
      return number;
    });

  it('50 concurrent openers get numbers 1..50: no gaps, no repeats', async () => {
    const w = await makeUser(t.db, 'w_counter');
    const tables = await Promise.all(range(50).map(() => makeTable(t.db)));
    const results = await Promise.all(tables.map((tb) => openOrderTx('2031-03-03', w.id, tb.id)));
    expect(sorted(results)).toEqual(range(50));
    const rows = await t.db.select().from(orders).where(eq(orders.day, '2031-03-03'));
    expect(sorted(rows.map((r) => r.number))).toEqual(range(50));
  });

  it('200 concurrent openers on a pool of 20 connections still produce 1..200', async () => {
    const w = await makeUser(t.db, 'w_counter200');
    const tables = await Promise.all(range(200).map(() => makeTable(t.db)));
    const results = await Promise.all(tables.map((tb) => openOrderTx('2031-04-04', w.id, tb.id)));
    expect(sorted(results)).toEqual(range(200));
  });

  it('transactions that roll back do not burn a number (no gaps)', async () => {
    const w = await makeUser(t.db, 'w_counter_rb');
    const tables = await Promise.all(range(60).map(() => makeTable(t.db)));
    const settled = await Promise.allSettled(
      tables.map((tb, i) => openOrderTx('2031-05-05', w.id, tb.id, i % 3 === 0)),
    );
    const committed = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    expect(committed).toHaveLength(40);
    expect(sorted(committed)).toEqual(range(40));
    const [counter] = await t.db
      .select()
      .from(orderCounters)
      .where(eq(orderCounters.day, '2031-05-05'));
    expect(counter?.last).toBe(40);
  });

  it('a failed insert (e.g. table already has an open check) rolls the number back too', async () => {
    const w = await makeUser(t.db, 'w_counter_dup');
    const tb = await makeTable(t.db);
    const day = '2031-06-06';
    expect(await openOrderTx(day, w.id, tb.id)).toBe(1);
    // same table again: unique index rejects the second open check
    await expect(openOrderTx(day, w.id, tb.id)).rejects.toThrow();
    const tb2 = await makeTable(t.db);
    expect(await openOrderTx(day, w.id, tb2.id)).toBe(2);
  });
});

describe('takeStock / returnStock (the last portion)', () => {
  it('30 concurrent takers of a 5-portion dish: exactly 5 win, stock ends at 0, never negative', async () => {
    const dish = await makeDish(t.db, { stock: 5 });
    const results = await Promise.all(range(30).map(() => takeStock(t.db, dish.id, 1)));
    expect(results.filter((r) => r !== undefined)).toHaveLength(5);
    const [row] = await t.db.select().from(dishes).where(eq(dishes.id, dish.id));
    expect(row?.stock).toBe(0);
  });

  it('two waiters, one portion: exactly one wins', async () => {
    for (let round = 0; round < 25; round++) {
      const dish = await makeDish(t.db, { stock: 1 });
      const [a, b] = await Promise.all([takeStock(t.db, dish.id, 1), takeStock(t.db, dish.id, 1)]);
      expect([a, b].filter((r) => r !== undefined)).toHaveLength(1);
      const [row] = await t.db.select().from(dishes).where(eq(dishes.id, dish.id));
      expect(row?.stock).toBe(0);
    }
  });

  it('a request bigger than the stock fails and changes nothing', async () => {
    const dish = await makeDish(t.db, { stock: 3 });
    expect(await takeStock(t.db, dish.id, 4)).toBeUndefined();
    expect((await takeStock(t.db, dish.id, 3))?.stock).toBe(0);
    expect(await takeStock(t.db, dish.id, 1)).toBeUndefined();
  });

  it('3 concurrent takers of 2 portions from stock 3: one wins, 1 left', async () => {
    const dish = await makeDish(t.db, { stock: 3 });
    const results = await Promise.all(range(3).map(() => takeStock(t.db, dish.id, 2)));
    expect(results.filter((r) => r !== undefined)).toHaveLength(1);
    const [row] = await t.db.select().from(dishes).where(eq(dishes.id, dish.id));
    expect(row?.stock).toBe(1);
  });

  it('unlimited dishes (NULL) are never exhausted and stay NULL', async () => {
    const dish = await makeDish(t.db, { stock: null });
    const results = await Promise.all(range(40).map(() => takeStock(t.db, dish.id, 1)));
    expect(results.every((r) => r !== undefined && r.stock === null)).toBe(true);
    await returnStock(t.db, dish.id, 5, 0);
    const [row] = await t.db.select().from(dishes).where(eq(dishes.id, dish.id));
    expect(row?.stock).toBeNull();
  });

  it('archived and unknown dishes cannot be taken', async () => {
    const dish = await makeDish(t.db, { stock: 10, archived: true });
    expect(await takeStock(t.db, dish.id, 1)).toBeUndefined();
    expect(await takeStock(t.db, '00000000-0000-4000-8000-000000000000', 1)).toBeUndefined();
  });

  it('returnStock gives portions back; interleaved takes/returns stay consistent', async () => {
    const dish = await makeDish(t.db, { stock: 10 });
    const ops = range(40).map((i) =>
      i % 2 === 0
        ? takeStock(t.db, dish.id, 1).then((r) => (r ? -1 : 0))
        : returnStock(t.db, dish.id, 1, 0).then(() => 1),
    );
    const deltas = await Promise.all(ops);
    const [row] = await t.db.select().from(dishes).where(eq(dishes.id, dish.id));
    expect(row?.stock).toBe(10 + deltas.reduce((a, b) => a + b, 0));
    expect(row!.stock!).toBeGreaterThanOrEqual(0);
  });

  it('a portion comes back only if it was really taken, and nobody set the stock by hand since', async () => {
    const dish = await makeDish(t.db, { stock: 3 });
    const taken = await takeStock(t.db, dish.id, 1);
    expect(taken).toEqual({ stock: 2, epoch: 0 });
    // taken under epoch 0 → comes back
    expect(await returnStock(t.db, dish.id, 1, taken!.epoch)).toEqual({ stock: 3 });
    // an item that took nothing (unlimited at the time) returns nothing
    expect(await returnStock(t.db, dish.id, 1, null)).toBeUndefined();
    // the manager set the stock by hand: the epoch moves on, old portions are not added back
    await t.db.update(dishes).set({ stock: 0, stockEpoch: 1 }).where(eq(dishes.id, dish.id));
    expect(await returnStock(t.db, dish.id, 1, 0)).toBeUndefined();
    const [row] = await t.db.select().from(dishes).where(eq(dishes.id, dish.id));
    expect(row?.stock).toBe(0); // the manager's stop-list stands
    // a dish that became unlimited after the item was sent never grows a number
    await t.db.update(dishes).set({ stock: null }).where(eq(dishes.id, dish.id));
    expect(await returnStock(t.db, dish.id, 1, 1)).toBeUndefined();
    const [row2] = await t.db.select().from(dishes).where(eq(dishes.id, dish.id));
    expect(row2?.stock).toBeNull();
  });

  it('rejects nonsense quantities', async () => {
    const dish = await makeDish(t.db, { stock: 3 });
    for (const q of [0, -1, 1.5, NaN]) {
      await expect(takeStock(t.db, dish.id, q)).rejects.toThrow(RangeError);
      await expect(returnStock(t.db, dish.id, q, 0)).rejects.toThrow(RangeError);
    }
  });

  it('transactions taking several dishes in sorted id order never deadlock', async () => {
    const [d1, d2, d3] = await Promise.all([
      makeDish(t.db, { stock: 1000 }),
      makeDish(t.db, { stock: 1000 }),
      makeDish(t.db, { stock: 1000 }),
    ]);
    const ids = [d1!.id, d2!.id, d3!.id].sort();
    await Promise.all(
      range(40).map(() =>
        t.db.transaction(async (tx) => {
          for (const id of ids) {
            if (!(await takeStock(tx, id, 1))) throw new Error('unexpected out of stock');
          }
        }),
      ),
    );
    const rows = await t.db.select().from(dishes).where(inArray(dishes.id, ids));
    expect(rows.map((r) => r.stock)).toEqual([960, 960, 960]);
  });

  it('a transaction that fails after taking stock gives it back (atomic send)', async () => {
    const dish = await makeDish(t.db, { stock: 2 });
    await expect(
      t.db.transaction(async (tx) => {
        await takeStock(tx, dish.id, 2);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    const [row] = await t.db.select().from(dishes).where(eq(dishes.id, dish.id));
    expect(row?.stock).toBe(2);
  });
});
