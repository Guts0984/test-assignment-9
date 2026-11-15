import { describe, expect, it } from 'vitest';
import { splitEqual } from '@app/shared';
import { localSplit } from './index';
import { makeItem } from '../../../test/utils';

/** Same check as apps/api/test/payments.test.ts (7 guests, 612,44): web and server must agree. */
const items = [
  makeItem(1, { unitPrice: 33333, guest: 1 }),
  makeItem(2, { unitPrice: 12345, guest: 2 }),
  makeItem(3, { unitPrice: 9998, guest: 3 }),
] as never;

describe('split bill (computed on the device)', () => {
  const order = { items, guests: 7, total: 61244, serviceFee: 5568 };
  it('equal on 3: 204,15 + 204,15 + 204,14 — the parts add up to the check', () => {
    const r = localSplit(order, { mode: 'equal', parts: 3 });
    expect(r.parts.map((p) => p.total)).toEqual([20415, 20415, 20414]);
    expect(r.parts.reduce((a, p) => a + p.total, 0)).toBe(order.total);
  });
  it('the assignment example: 100,00 on 3 = 33,34 + 33,33 + 33,33', () => {
    expect(splitEqual(10000, 3)).toEqual([3334, 3333, 3333]);
    const r = localSplit(
      { items: [], guests: 2, total: 10000, serviceFee: 0 },
      { mode: 'equal', parts: 3 },
    );
    expect(r.parts.map((p) => p.total)).toEqual([3334, 3333, 3333]);
  });
  it('per guest: each pays for their own items plus a share of the fee; sums to the total', () => {
    const r = localSplit(order, { mode: 'guests' });
    expect(r.parts.map((p) => [p.guest, p.subtotal])).toEqual([
      [1, 33333],
      [2, 12345],
      [3, 9998],
    ]);
    expect(r.parts.reduce((a, p) => a + p.total, 0)).toBe(61244);
    expect(r.parts.reduce((a, p) => a + p.serviceFee, 0)).toBe(5568);
  });
  it('equal split for every N from 2 to 50 always sums to the total', () => {
    for (let n = 2; n <= 50; n++) {
      const r = localSplit(order, { mode: 'equal', parts: n });
      expect(
        r.parts.reduce((a, p) => a + p.total, 0),
        `N=${n}`,
      ).toBe(61244);
      expect(
        r.parts.reduce((a, p) => a + p.serviceFee, 0),
        `N=${n}`,
      ).toBe(5568);
    }
  });
});
