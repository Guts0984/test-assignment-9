import { describe, expect, it } from 'vitest';
import { groupByGuest, liveTotals } from './model';
import { makeItem } from '../../../test/utils';

/**
 * These numbers are the same ones the API test-suite asserts for the same check
 * (apps/api/test/payments.test.ts: "7 guests … equal split on 3"), so web and server agree.
 */
const items = [
  makeItem(1, { unitPrice: 33333, guest: 1 }),
  makeItem(2, { unitPrice: 12345, guest: 2 }),
  makeItem(3, { unitPrice: 9998, guest: 3 }),
] as never;

describe('totals on screen = totals on the server', () => {
  it('7 guests: subtotal 556,76, service fee 55,68, total 612,44', () => {
    expect(liveTotals({ items, guests: 7 })).toEqual({
      subtotal: 55676,
      serviceFee: 5568,
      total: 61244,
    });
  });
  it('5 guests: no service fee', () => {
    expect(liveTotals({ items, guests: 5 })).toEqual({
      subtotal: 55676,
      serviceFee: 0,
      total: 55676,
    });
  });
  it('drafts and cancelled items are not billed', () => {
    const mixed = [
      ...(items as unknown[]),
      makeItem(4, { status: 'draft' }),
      makeItem(5, { status: 'cancelled' }),
    ] as never;
    expect(liveTotals({ items: mixed, guests: 7 }).subtotal).toBe(55676);
  });
});

describe('groupByGuest', () => {
  it('orders guests ascending and keeps item order inside', () => {
    const g = groupByGuest([
      makeItem(1, { guest: 3 }),
      makeItem(2, { guest: 1 }),
      makeItem(3, { guest: 3 }),
    ] as never);
    expect(g.map((x) => [x.guest, x.items.length])).toEqual([
      [1, 1],
      [3, 2],
    ]);
  });
});
