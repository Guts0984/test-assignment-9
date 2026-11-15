/**
 * Money math. Pure functions, integer kopecks only.
 * The server and the web app both use these, so the on-screen total always equals the server total.
 */
import type { ItemStatus } from './enums';

export const SERVICE_FEE_PERCENT = 10;
export const SERVICE_FEE_MIN_GUESTS = 6;

/** Items in these statuses are on the bill. Drafts (not sent) and cancelled items are not. */
export const BILLABLE_STATUSES: readonly ItemStatus[] = ['sent', 'cooking', 'ready', 'served'];

export type BillItem = { unitPrice: number; status: ItemStatus; guest: number };
export type Totals = { subtotal: number; serviceFee: number; total: number };
export type GuestPart = { guest: number; subtotal: number; serviceFee: number; total: number };

const assertKopecks = (n: number, name: string): void => {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer (kopecks), got ${n}`);
  }
};

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Dish price plus modifier surcharges: surcharges are part of the item price. */
export const itemUnitPrice = (dishPrice: number, surcharges: readonly number[]): number => {
  assertKopecks(dishPrice, 'dishPrice');
  surcharges.forEach((s) => assertKopecks(s, 'surcharge'));
  return dishPrice + sum(surcharges);
};

const billable = (items: readonly BillItem[]): BillItem[] =>
  items.filter((i) => BILLABLE_STATUSES.includes(i.status));

export const subtotalOf = (items: readonly BillItem[]): number => {
  const billed = billable(items);
  billed.forEach((i) => assertKopecks(i.unitPrice, 'unitPrice'));
  const total = sum(billed.map((i) => i.unitPrice));
  assertKopecks(total, 'subtotal');
  return total;
};

/** 10% of the subtotal, rounded half up to a kopeck, only for 6+ guests. */
export const serviceFee = (subtotal: number, guests: number): number => {
  assertKopecks(subtotal, 'subtotal');
  if (!Number.isInteger(guests) || guests < 1) throw new RangeError(`guests must be >= 1`);
  if (guests < SERVICE_FEE_MIN_GUESTS) return 0;
  return Math.floor((subtotal * SERVICE_FEE_PERCENT + 50) / 100);
};

export const orderTotals = (items: readonly BillItem[], guests: number): Totals => {
  const subtotal = subtotalOf(items);
  const fee = serviceFee(subtotal, guests);
  return { subtotal, serviceFee: fee, total: subtotal + fee };
};

/**
 * Equal split of an amount into N parts that always sums to the amount.
 * The first `amount mod N` parts get one extra kopeck: 10000 / 3 → [3334, 3333, 3333].
 */
export const splitEqual = (amount: number, parts: number): number[] => {
  assertKopecks(amount, 'amount');
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError('parts must be an integer >= 1');
  const base = Math.floor(amount / parts);
  const extra = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
};

/**
 * Largest-remainder allocation: splits `amount` proportionally to `weights`; Σ result === amount.
 * Ties go to the lower index (deterministic). Uses BigInt for amount × weight (can exceed 2^53).
 */
export const allocateByWeights = (amount: number, weights: readonly number[]): number[] => {
  assertKopecks(amount, 'amount');
  weights.forEach((w) => assertKopecks(w, 'weight'));
  const totalWeight = sum(weights);
  if (weights.length === 0) {
    if (amount === 0) return [];
    throw new RangeError('Cannot allocate a non-zero amount over no weights');
  }
  if (totalWeight === 0) {
    if (amount === 0) return weights.map(() => 0);
    throw new RangeError('Cannot allocate a non-zero amount over zero total weight');
  }
  const a = BigInt(amount);
  const w = BigInt(totalWeight);
  const quotas = weights.map((weight, index) => {
    const product = a * BigInt(weight);
    return { index, floor: Number(product / w), remainder: product % w };
  });
  const leftover = amount - sum(quotas.map((q) => q.floor));
  const order = [...quotas].sort((x, y) =>
    x.remainder === y.remainder ? x.index - y.index : x.remainder > y.remainder ? -1 : 1,
  );
  const bonus = new Set(order.slice(0, leftover).map((q) => q.index));
  return quotas.map((q) => q.floor + (bonus.has(q.index) ? 1 : 0));
};

/**
 * Per-guest bill. Each guest pays for their own items; the service fee (if any) is shared in
 * proportion to what each guest ordered. Only guests with billable items get a part.
 * Σ part.total === orderTotals(items, guests).total.
 */
export const splitByGuests = (items: readonly BillItem[], guests: number): GuestPart[] => {
  const { subtotal, serviceFee: fee } = orderTotals(items, guests);
  const billed = billable(items);
  const guestNumbers = [...new Set(billed.map((i) => i.guest))].sort((a, b) => a - b);
  const subtotals = guestNumbers.map((g) =>
    sum(billed.filter((i) => i.guest === g).map((i) => i.unitPrice)),
  );
  if (subtotal === 0) return [];
  const fees = allocateByWeights(fee, subtotals);
  return guestNumbers.map((guest, i) => {
    const s = subtotals[i] ?? 0;
    const f = fees[i] ?? 0;
    return { guest, subtotal: s, serviceFee: f, total: s + f };
  });
};

export const remainingToPay = (total: number, paid: number): number => {
  assertKopecks(total, 'total');
  assertKopecks(paid, 'paid');
  return Math.max(0, total - paid);
};

/** Change due for a cash payment. Throws if the guest handed over less than the amount. */
export const cashChange = (tendered: number, amount: number): number => {
  assertKopecks(tendered, 'tendered');
  assertKopecks(amount, 'amount');
  if (tendered < amount) throw new RangeError('tendered is less than amount');
  return tendered - amount;
};
