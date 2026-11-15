import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatMoney, moneyToInput, parseMoneyInput } from './money';

const NBSP = ' ';

describe('formatMoney', () => {
  it('uk: 1 234,50 ₴ (space thousands, comma decimals, symbol after)', () => {
    const s = formatMoney(123450, 'uk');
    expect(s.replace(/\s/g, ' ')).toBe('1 234,50 ₴');
    expect(s).toContain('₴');
    expect(s.endsWith('₴')).toBe(true);
    expect(s).toContain(',50');
  });
  it('en: ₴1,234.50', () => {
    expect(formatMoney(123450, 'en')).toBe('₴1,234.50');
  });
  it('always two decimals, from zero to millions', () => {
    expect(formatMoney(0, 'en')).toBe('₴0.00');
    expect(formatMoney(5, 'en')).toBe('₴0.05');
    expect(formatMoney(100, 'en')).toBe('₴1.00');
    expect(formatMoney(99, 'uk').replace(/\s/g, ' ')).toBe('0,99 ₴');
    expect(formatMoney(2_000_000_000, 'en')).toBe('₴20,000,000.00');
    expect(formatMoney(100_000_000_000, 'uk').replace(/\s/g, ' ')).toBe('1 000 000 000,00 ₴');
  });
  it('negative amounts keep the sign', () => {
    expect(formatMoney(-12345, 'en')).toBe('-₴123.45');
  });
  it('property: the digits shown are exactly the kopecks (no float drift)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), (k) => {
        const digits = formatMoney(k, 'en').replace(/[^\d]/g, '');
        expect(digits).toBe(String(k).padStart(3, '0'));
      }),
      { numRuns: 500 },
    );
  });
  it('uses a non-breaking space so the symbol never wraps onto its own line (uk)', () => {
    expect(formatMoney(123450, 'uk')).toContain(NBSP);
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12,5', 1250],
    ['12,50', 1250],
    ['0,07', 7],
    ['0.7', 70],
    ['1 234,50', 123450],
    [`1${NBSP}234.50`, 123450],
    ['  99  ', 9900],
    ['0', 0],
    ['100000', 10_000_000],
  ])('accepts %j → %i kopecks', (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });
  it.each([
    '',
    ' ',
    'abc',
    '12.345',
    '12,345',
    '-5',
    '+5',
    '1e3',
    '12..5',
    '.5',
    '5.',
    '12,5,0',
    '1_000',
    '١٢',
    '12 ₴',
    'NaN',
    'Infinity',
    '12.5.5',
  ])('rejects %j', (input) => {
    expect(parseMoneyInput(input)).toBeNull();
  });
  it('rejects numbers too large to be safe integers', () => {
    expect(parseMoneyInput('9'.repeat(30))).toBeNull();
  });
  it('0.1 + 0.2 style traps: 0,30 is exactly 30 kopecks', () => {
    expect(parseMoneyInput('0.1')! + parseMoneyInput('0.2')!).toBe(parseMoneyInput('0.3'));
  });
  it('property: moneyToInput → parseMoneyInput round-trips in both locales', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000 }),
        fc.constantFrom('uk', 'en' as const),
        (k, loc) => {
          expect(parseMoneyInput(moneyToInput(k, loc as 'uk' | 'en'))).toBe(k);
        },
      ),
      { numRuns: 500 },
    );
  });
});
