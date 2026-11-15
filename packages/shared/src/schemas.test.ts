import { describe, expect, it } from 'vitest';
import {
  AddItemBody,
  DishCreate,
  DishPatch,
  LIMITS,
  LoginBody,
  OpenOrderBody,
  PaymentBody,
  RevenueQuery,
  SplitBody,
  VersionQuery,
  calendarDate,
  kopecks,
  text,
} from './index';

const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ok = (r: { success: boolean }) => r.success;

describe('kopecks', () => {
  it.each([0, 1, 100, LIMITS.maxKopecks])('accepts %s', (n) => {
    expect(ok(kopecks.safeParse(n))).toBe(true);
  });
  it.each([
    -1,
    0.5,
    1.0000001,
    NaN,
    Infinity,
    -Infinity,
    LIMITS.maxKopecks + 1,
    Number.MAX_SAFE_INTEGER,
    '100',
    null,
    undefined,
    {},
    [],
    true,
  ])('rejects %s', (n) => {
    expect(ok(kopecks.safeParse(n))).toBe(false);
  });
});

describe('text', () => {
  it('trims and rejects empty / whitespace-only', () => {
    expect(text().parse('  Borsch  ')).toBe('Borsch');
    expect(ok(text().safeParse('   '))).toBe(false);
    expect(ok(text().safeParse(''))).toBe(false);
  });
  it('rejects control characters including NUL', () => {
    expect(ok(text().safeParse('a\u0000b'))).toBe(false);
    expect(ok(text().safeParse('a\nb'))).toBe(false);
    expect(ok(text().safeParse('a\u007Fb'))).toBe(false);
  });
  it('enforces max length', () => {
    expect(ok(text(5).safeParse('abcdef'))).toBe(false);
    expect(ok(text(5).safeParse('abcde'))).toBe(true);
  });
  it('accepts Ukrainian and emoji', () => {
    expect(ok(text().safeParse('Борщ з пампушками 🍲'))).toBe(true);
  });
});

describe('calendarDate', () => {
  it.each(['2025-02-30', '2025-13-01', '2025-00-10', '2025-1-1', '20250101', '2025-02-29'])(
    'rejects %s',
    (s) => expect(ok(calendarDate.safeParse(s))).toBe(false),
  );
  it.each(['2024-02-29', '2025-12-31'])('accepts %s', (s) =>
    expect(ok(calendarDate.safeParse(s))).toBe(true),
  );
});

describe('RevenueQuery', () => {
  it('accepts exactly 60 days (inclusive) and rejects 61', () => {
    expect(ok(RevenueQuery.safeParse({ from: '2025-01-01', to: '2025-03-01' }))).toBe(true); // 60 days
    expect(ok(RevenueQuery.safeParse({ from: '2025-01-01', to: '2025-03-02' }))).toBe(false); // 61
  });
  it('accepts a single day, rejects reversed', () => {
    expect(ok(RevenueQuery.safeParse({ from: '2025-01-01', to: '2025-01-01' }))).toBe(true);
    expect(ok(RevenueQuery.safeParse({ from: '2025-01-02', to: '2025-01-01' }))).toBe(false);
  });
  it('handles leap year boundary', () => {
    // 2024-01-01 .. 2024-02-29 = 31 + 29 = 60 days
    expect(ok(RevenueQuery.safeParse({ from: '2024-01-01', to: '2024-02-29' }))).toBe(true);
    expect(ok(RevenueQuery.safeParse({ from: '2024-01-01', to: '2024-03-01' }))).toBe(false);
  });
  it('rejects missing, extra and non-string values', () => {
    expect(ok(RevenueQuery.safeParse({ from: '2025-01-01' }))).toBe(false);
    expect(ok(RevenueQuery.safeParse({ from: '2025-01-01', to: '2025-01-02', x: 1 }))).toBe(false);
    expect(ok(RevenueQuery.safeParse({ from: 20250101, to: 20250102 }))).toBe(false);
  });
});

describe('menu schemas', () => {
  const group = (over: Record<string, unknown> = {}) => ({
    name: 'Doneness',
    min: 1,
    max: 1,
    modifiers: [
      { name: 'Medium', surcharge: 0 },
      { name: 'Well done', surcharge: 0 },
    ],
    ...over,
  });
  const dish = (over: Record<string, unknown> = {}) => ({
    name: 'Steak',
    category: 'Mains',
    price: 25000,
    station: 'kitchen',
    stock: null,
    modifierGroups: [group()],
    ...over,
  });

  it('accepts a valid dish, unlimited stock = null', () => {
    expect(ok(DishCreate.safeParse(dish()))).toBe(true);
  });
  it('rejects min > max, max > modifiers, max = 0', () => {
    expect(ok(DishCreate.safeParse(dish({ modifierGroups: [group({ min: 2, max: 1 })] })))).toBe(
      false,
    );
    expect(ok(DishCreate.safeParse(dish({ modifierGroups: [group({ max: 3 })] })))).toBe(false);
    expect(ok(DishCreate.safeParse(dish({ modifierGroups: [group({ min: 0, max: 0 })] })))).toBe(
      false,
    );
  });
  it('rejects negative/float/oversized price, stock and surcharge', () => {
    expect(ok(DishCreate.safeParse(dish({ price: -1 })))).toBe(false);
    expect(ok(DishCreate.safeParse(dish({ price: 10.5 })))).toBe(false);
    expect(ok(DishCreate.safeParse(dish({ stock: -1 })))).toBe(false);
    expect(ok(DishCreate.safeParse(dish({ stock: 1.5 })))).toBe(false);
    expect(ok(DishCreate.safeParse(dish({ stock: LIMITS.maxStock + 1 })))).toBe(false);
    expect(
      ok(
        DishCreate.safeParse(
          dish({ modifierGroups: [group({ modifiers: [{ name: 'x', surcharge: -5 }], max: 1 })] }),
        ),
      ),
    ).toBe(false);
  });
  it('rejects bad station and unknown keys (mass assignment)', () => {
    expect(ok(DishCreate.safeParse(dish({ station: 'grill' })))).toBe(false);
    expect(ok(DishCreate.safeParse(dish({ id: uuid })))).toBe(false);
    expect(ok(DishCreate.safeParse(dish({ archived: true })))).toBe(false);
  });
  it('rejects __proto__ pollution attempt', () => {
    const evil = JSON.parse(
      '{"name":"a","category":"b","price":1,"station":"bar","stock":null,"modifierGroups":[],"__proto__":{"admin":true}}',
    );
    expect(ok(DishCreate.safeParse(evil))).toBe(false);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
  it('patch requires at least one field and validates it', () => {
    expect(ok(DishPatch.safeParse({}))).toBe(false);
    expect(ok(DishPatch.safeParse({ stock: 5 }))).toBe(true);
    expect(ok(DishPatch.safeParse({ stock: null }))).toBe(true);
    expect(ok(DishPatch.safeParse({ price: -1 }))).toBe(false);
  });
});

describe('orders schemas', () => {
  it('open order bounds guests', () => {
    expect(ok(OpenOrderBody.safeParse({ tableId: uuid, guests: 1 }))).toBe(true);
    expect(ok(OpenOrderBody.safeParse({ tableId: uuid, guests: 0 }))).toBe(false);
    expect(ok(OpenOrderBody.safeParse({ tableId: uuid, guests: LIMITS.maxGuests + 1 }))).toBe(
      false,
    );
    expect(ok(OpenOrderBody.safeParse({ tableId: uuid, guests: 2.5 }))).toBe(false);
    expect(ok(OpenOrderBody.safeParse({ tableId: 'not-a-uuid', guests: 2 }))).toBe(false);
  });
  it('add item: defaults, guest >= 1, comment bound, unknown keys rejected', () => {
    const base = { dishId: uuid, guest: 1, expectedVersion: 0 };
    const parsed = AddItemBody.parse(base);
    expect(parsed.modifierIds).toEqual([]);
    expect(parsed.comment).toBe('');
    expect(ok(AddItemBody.safeParse({ ...base, guest: 0 }))).toBe(false);
    expect(ok(AddItemBody.safeParse({ ...base, comment: 'x'.repeat(201) }))).toBe(false);
    expect(ok(AddItemBody.safeParse({ ...base, status: 'ready' }))).toBe(false);
    expect(ok(AddItemBody.safeParse({ ...base, price: 1 }))).toBe(false);
    expect(ok(AddItemBody.safeParse({ ...base, expectedVersion: -1 }))).toBe(false);
  });
  it('version query coerces from string but rejects garbage', () => {
    expect(VersionQuery.parse({ expectedVersion: '3' }).expectedVersion).toBe(3);
    for (const v of [
      '',
      ' ',
      ' 3',
      '3 ',
      '0x10',
      '1e3',
      'abc',
      '-1',
      '1.5',
      'NaN',
      'Infinity',
      '99999999999',
      '2147483648',
    ])
      expect(ok(VersionQuery.safeParse({ expectedVersion: v }))).toBe(false);
  });
});

describe('split / payment schemas', () => {
  it('split parts: equal needs 2…max, guests takes no parts', () => {
    expect(ok(SplitBody.safeParse({ mode: 'equal', parts: 3 }))).toBe(true);
    expect(ok(SplitBody.safeParse({ mode: 'equal', parts: 1 }))).toBe(false);
    expect(ok(SplitBody.safeParse({ mode: 'equal', parts: 0 }))).toBe(false);
    expect(ok(SplitBody.safeParse({ mode: 'equal', parts: 51 }))).toBe(false);
    expect(ok(SplitBody.safeParse({ mode: 'equal' }))).toBe(false);
    expect(ok(SplitBody.safeParse({ mode: 'guests' }))).toBe(true);
    expect(ok(SplitBody.safeParse({ mode: 'guests', parts: 3 }))).toBe(false);
    expect(ok(SplitBody.safeParse({ mode: 'other' }))).toBe(false);
  });
  const pay = (over: Record<string, unknown> = {}) => ({
    id: uuid,
    method: 'cash',
    amount: 1000,
    tendered: 1000,
    expectedVersion: 1,
    ...over,
  });
  it('cash needs tendered >= amount; card must not have tendered', () => {
    expect(ok(PaymentBody.safeParse(pay()))).toBe(true);
    expect(ok(PaymentBody.safeParse(pay({ tendered: 2000 })))).toBe(true);
    expect(ok(PaymentBody.safeParse(pay({ tendered: 999 })))).toBe(false);
    expect(ok(PaymentBody.safeParse(pay({ tendered: undefined })))).toBe(false);
    expect(ok(PaymentBody.safeParse(pay({ method: 'card', tendered: undefined })))).toBe(true);
    expect(ok(PaymentBody.safeParse(pay({ method: 'card' })))).toBe(false);
  });
  it('rejects zero/negative/float amount, bad id, bad method, unknown keys', () => {
    expect(ok(PaymentBody.safeParse(pay({ amount: 0, tendered: 0 })))).toBe(false);
    expect(ok(PaymentBody.safeParse(pay({ amount: -5 })))).toBe(false);
    expect(ok(PaymentBody.safeParse(pay({ amount: 10.5 })))).toBe(false);
    expect(ok(PaymentBody.safeParse(pay({ id: '123' })))).toBe(false);
    expect(ok(PaymentBody.safeParse(pay({ method: 'crypto' })))).toBe(false);
    expect(ok(PaymentBody.safeParse(pay({ orderId: uuid })))).toBe(false);
  });
});

describe('LoginBody', () => {
  it('accepts normal credentials', () => {
    expect(ok(LoginBody.safeParse({ username: 'waiter1', password: 'x' }))).toBe(true);
  });
  it('rejects injection-ish usernames, oversized and non-string fields', () => {
    expect(ok(LoginBody.safeParse({ username: "a' OR '1'='1", password: 'x' }))).toBe(false);
    expect(ok(LoginBody.safeParse({ username: 'ab', password: 'x' }))).toBe(false);
    expect(ok(LoginBody.safeParse({ username: 'a'.repeat(33), password: 'x' }))).toBe(false);
    expect(ok(LoginBody.safeParse({ username: 'waiter1', password: 'x'.repeat(129) }))).toBe(false);
    expect(ok(LoginBody.safeParse({ username: 'waiter1', password: '' }))).toBe(false);
    expect(ok(LoginBody.safeParse({ username: { $ne: null }, password: { $ne: null } }))).toBe(
      false,
    );
    expect(ok(LoginBody.safeParse({ username: 'waiter1', password: ['a'] }))).toBe(false);
    expect(ok(LoginBody.safeParse({ username: 'waiter1', password: 'x', role: 'manager' }))).toBe(
      false,
    );
  });
});
