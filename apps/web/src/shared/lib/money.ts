import type { Locale } from '@/shared/i18n/routing';

/** Locales → the Intl locale used for numbers. uk gives `1 234,50 ₴`, en gives `₴1,234.50`. */
const INTL_LOCALE: Record<Locale, string> = { uk: 'uk-UA', en: 'en-US' };

const formatters = new Map<Locale, Intl.NumberFormat>();
const formatter = (locale: Locale): Intl.NumberFormat => {
  let f = formatters.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(INTL_LOCALE[locale], {
      style: 'currency',
      currency: 'UAH',
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(locale, f);
  }
  return f;
};

/** Integer kopecks → localized money string. The division by 100 is exact for |n| < 2^53 / 100. */
export const formatMoney = (kopecks: number, locale: Locale): string => {
  const negative = kopecks < 0;
  const abs = Math.abs(kopecks);
  const whole = Math.trunc(abs / 100);
  const cents = abs % 100;
  // Format via parts so we never push a float through Intl (0.1 + 0.2 style errors).
  const f = formatter(locale);
  const text = f.format(whole + cents / 100);
  return negative ? `-${text}` : text;
};

/**
 * Parses what a person types into integer kopecks. Accepts `12`, `12.5`, `12,50`, spaces and
 * non-breaking spaces as thousands separators. Returns null for anything else (letters, more than two
 * decimals, negatives, empty). No floating point is used: the digits are split and combined as integers.
 */
export const parseMoneyInput = (input: string): number | null => {
  const cleaned = input.replace(/\s/g, ''); // \s also covers the non-breaking spaces Intl produces
  if (!/^\d+([.,]\d{1,2})?$/.test(cleaned)) return null;
  const [whole = '0', frac = ''] = cleaned.split(/[.,]/);
  const kopecks = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(kopecks) ? kopecks : null;
};

/** Kopecks → the plain editable string for an input (`12.50` / `12,50` by locale, no grouping). */
export const moneyToInput = (kopecks: number, locale: Locale): string => {
  const whole = Math.trunc(kopecks / 100);
  const cents = String(kopecks % 100).padStart(2, '0');
  return `${whole}${locale === 'uk' ? ',' : '.'}${cents}`;
};
