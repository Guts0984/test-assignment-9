import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type BillItem,
  allocateByWeights,
  cashChange,
  itemUnitPrice,
  orderTotals,
  remainingToPay,
  serviceFee,
  splitByGuests,
  splitEqual,
  subtotalOf,
} from './money';
import { itemStatuses } from './enums';

const item = (unitPrice: number, guest = 1, status: BillItem['status'] = 'sent'): BillItem => ({
  unitPrice,
  guest,
  status,
});
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const billItems = fc.array(
  fc.record({
    unitPrice: fc.integer({ min: 0, max: 5_000_000 }),
    guest: fc.integer({ min: 1, max: 12 }),
    status: fc.constantFrom(...itemStatuses),
  }),
  { maxLength: 40 },
);

describe('itemUnitPrice', () => {
  it('adds modifier surcharges to the dish price', () => {
    expect(itemUnitPrice(25000, [0, 1500, 2000])).toBe(28500);
    expect(itemUnitPrice(100, [])).toBe(100);
  });
  it('rejects floats, negatives, NaN', () => {
    expect(() => itemUnitPrice(1.5, [])).toThrow(RangeError);
    expect(() => itemUnitPrice(100, [-1])).toThrow(RangeError);
    expect(() => itemUnitPrice(NaN, [])).toThrow(RangeError);
  });
});

describe('subtotal / billable statuses', () => {
  it('counts sent/cooking/ready/served, ignores draft and cancelled', () => {
    const items = [
      item(100, 1, 'draft'),
      item(200, 1, 'sent'),
      item(400, 1, 'cooking'),
      item(800, 1, 'ready'),
      item(1600, 1, 'served'),
      item(3200, 1, 'cancelled'),
    ];
    expect(subtotalOf(items)).toBe(3000);
  });
});

describe('serviceFee', () => {
  it('is 0 below 6 guests and 10% from 6 guests', () => {
    expect(serviceFee(100_000, 5)).toBe(0);
    expect(serviceFee(100_000, 6)).toBe(10_000);
    expect(serviceFee(100_000, 50)).toBe(10_000);
  });
  it('rounds half up to the kopeck', () => {
    expect(serviceFee(4, 6)).toBe(0); // 0.4 → 0
    expect(serviceFee(5, 6)).toBe(1); // 0.5 → 1
    expect(serviceFee(14, 6)).toBe(1); // 1.4 → 1
    expect(serviceFee(15, 6)).toBe(2); // 1.5 → 2
    expect(serviceFee(0, 6)).toBe(0);
  });
  it('matches an independent integer reference for any subtotal', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), (s) => {
        const q = Math.floor(s / 10);
        const r = s % 10;
        expect(serviceFee(s, 6)).toBe(q + (r >= 5 ? 1 : 0));
      }),
    );
  });
  it('rejects invalid guests', () => {
    expect(() => serviceFee(100, 0)).toThrow(RangeError);
    expect(() => serviceFee(100, 2.5)).toThrow(RangeError);
  });
});

describe('splitEqual', () => {
  it('100,00 on 3 = 33,34 + 33,33 + 33,33', () => {
    expect(splitEqual(10_000, 3)).toEqual([3334, 3333, 3333]);
  });
  it('edge cases', () => {
    expect(splitEqual(0, 3)).toEqual([0, 0, 0]);
    expect(splitEqual(1, 3)).toEqual([1, 0, 0]);
    expect(splitEqual(5, 1)).toEqual([5]);
    expect(splitEqual(2, 5)).toEqual([1, 1, 0, 0, 0]);
  });
  it('rejects bad parts and amounts', () => {
    expect(() => splitEqual(100, 0)).toThrow(RangeError);
    expect(() => splitEqual(100, -1)).toThrow(RangeError);
    expect(() => splitEqual(100, 1.5)).toThrow(RangeError);
    expect(() => splitEqual(-1, 3)).toThrow(RangeError);
    expect(() => splitEqual(0.5, 3)).toThrow(RangeError);
  });
  it('property: sums to the total, parts differ by at most 1, never negative, non-increasing', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.integer({ min: 1, max: 50 }),
        (amount, parts) => {
          const r = splitEqual(amount, parts);
          expect(r).toHaveLength(parts);
          expect(sum(r)).toBe(amount);
          expect(Math.max(...r) - Math.min(...r)).toBeLessThanOrEqual(1);
          expect(Math.min(...r)).toBeGreaterThanOrEqual(0);
          for (let i = 1; i < r.length; i++) expect(r[i]!).toBeLessThanOrEqual(r[i - 1]!);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('allocateByWeights', () => {
  it('property: sums to amount, each part within 1 kopeck of its exact share', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.array(fc.integer({ min: 0, max: 10_000_000_000 }), { minLength: 1, maxLength: 20 }),
        (amount, weights) => {
          fc.pre(sum(weights) > 0);
          const r = allocateByWeights(amount, weights);
          expect(sum(r)).toBe(amount);
          const total = BigInt(sum(weights));
          r.forEach((part, i) => {
            const exact = (BigInt(amount) * BigInt(weights[i]!)) / total; // floor
            expect(BigInt(part) - exact).toBeGreaterThanOrEqual(0n);
            expect(BigInt(part) - exact).toBeLessThanOrEqual(1n);
            if (weights[i] === 0) expect(part).toBe(0);
          });
        },
      ),
      { numRuns: 500 },
    );
  });
  it('does not overflow when amount × weight exceeds 2^53', () => {
    const r = allocateByWeights(1_000_000_000, [10_000_000_000, 10_000_000_000, 10_000_000_000]);
    expect(sum(r)).toBe(1_000_000_000);
    expect(r).toEqual([333_333_334, 333_333_333, 333_333_333]);
  });
  it('is deterministic on ties (lower index first)', () => {
    expect(allocateByWeights(1, [5, 5, 5])).toEqual([1, 0, 0]);
  });
  it('edge cases', () => {
    expect(allocateByWeights(0, [0, 0])).toEqual([0, 0]);
    expect(allocateByWeights(0, [])).toEqual([]);
    expect(() => allocateByWeights(5, [0, 0])).toThrow(RangeError);
    expect(() => allocateByWeights(5, [])).toThrow(RangeError);
    expect(() => allocateByWeights(5, [-1, 3])).toThrow(RangeError);
  });
});

describe('orderTotals', () => {
  it('acceptance #6: 7 guests has a service fee and the equal split sums to the cent', () => {
    const items = [item(33_333, 1), item(12_345, 2), item(9_999, 7)];
    const t = orderTotals(items, 7);
    expect(t.subtotal).toBe(55_677);
    expect(t.serviceFee).toBe(5_568); // 5567.7 → 5568
    expect(t.total).toBe(61_245);
    const parts = splitEqual(t.total, 3);
    expect(parts).toEqual([20_415, 20_415, 20_415]);
    expect(sum(parts)).toBe(t.total);
  });
  it('no fee for 5 guests', () => {
    expect(orderTotals([item(10_000)], 5)).toEqual({
      subtotal: 10_000,
      serviceFee: 0,
      total: 10_000,
    });
  });
});

describe('splitByGuests', () => {
  it('shares the fee in proportion and sums to the total', () => {
    const items = [item(10_000, 1), item(20_000, 2), item(30_000, 3)];
    const parts = splitByGuests(items, 6);
    expect(parts).toEqual([
      { guest: 1, subtotal: 10_000, serviceFee: 1_000, total: 11_000 },
      { guest: 2, subtotal: 20_000, serviceFee: 2_000, total: 22_000 },
      { guest: 3, subtotal: 30_000, serviceFee: 3_000, total: 33_000 },
    ]);
  });
  it('omits guests with no billable items; ignores drafts and cancelled', () => {
    const parts = splitByGuests(
      [item(100, 1), item(999, 2, 'draft'), item(999, 3, 'cancelled'), item(200, 4)],
      4,
    );
    expect(parts.map((p) => p.guest)).toEqual([1, 4]);
  });
  it('returns no parts for an empty bill', () => {
    expect(splitByGuests([], 7)).toEqual([]);
    expect(splitByGuests([item(100, 1, 'draft')], 7)).toEqual([]);
  });
  it('property: Σ part totals === order total, fee zero below 6 guests, no negatives', () => {
    fc.assert(
      fc.property(billItems, fc.integer({ min: 1, max: 12 }), (items, guests) => {
        const totals = orderTotals(items, guests);
        const parts = splitByGuests(items, guests);
        expect(sum(parts.map((p) => p.total))).toBe(totals.total);
        expect(sum(parts.map((p) => p.serviceFee))).toBe(totals.serviceFee);
        expect(sum(parts.map((p) => p.subtotal))).toBe(totals.subtotal);
        parts.forEach((p) => {
          expect(p.total).toBe(p.subtotal + p.serviceFee);
          expect(p.total).toBeGreaterThanOrEqual(0);
        });
        if (guests < 6) expect(totals.serviceFee).toBe(0);
      }),
      { numRuns: 500 },
    );
  });
});

describe('payments helpers', () => {
  it('change = tendered - amount; refuses short cash', () => {
    expect(cashChange(10_000, 7_350)).toBe(2_650);
    expect(cashChange(500, 500)).toBe(0);
    expect(() => cashChange(499, 500)).toThrow(RangeError);
  });
  it('remaining never goes negative', () => {
    expect(remainingToPay(1000, 400)).toBe(600);
    expect(remainingToPay(1000, 1000)).toBe(0);
    expect(remainingToPay(1000, 1500)).toBe(0);
  });
});
