import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { useTranslations } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { renderApp, MESSAGES, type TestLocale } from './utils';

const Items = ({
  ns,
  k,
  count,
}: {
  ns: 'common' | 'order' | 'tables';
  k: string;
  count: number;
}) => {
  const t = useTranslations(ns);
  const translate = t as unknown as (key: string, values: { count: number }) => string;
  return <span data-testid="out">{translate(k, { count })}</span>;
};
const render = (
  locale: TestLocale,
  ns: 'common' | 'order' | 'tables',
  k: string,
  count: number,
) => {
  const view = renderApp(<Items ns={ns} k={k} count={count} />, { locale });
  const text = view.getByTestId('out').textContent;
  view.unmount();
  return text;
};

describe('plurals — Ukrainian has four forms', () => {
  const cases: [number, string][] = [
    [0, '0 позицій'],
    [1, '1 позиція'],
    [2, '2 позиції'],
    [3, '3 позиції'],
    [4, '4 позиції'],
    [5, '5 позицій'],
    [11, '11 позицій'],
    [12, '12 позицій'],
    [14, '14 позицій'],
    [21, '21 позиція'],
    [22, '22 позиції'],
    [25, '25 позицій'],
    [101, '101 позиція'],
    [111, '111 позицій'],
  ];
  it.each(cases)('%i → %s', (n, expected) => {
    expect(render('uk', 'common', 'items', n)).toBe(expected);
  });
  it('the assignment examples: «3 позиції», «5 позицій»', () => {
    expect(render('uk', 'common', 'items', 3)).toBe('3 позиції');
    expect(render('uk', 'common', 'items', 5)).toBe('5 позицій');
  });
  it('guests, seats and new items decline too', () => {
    expect(render('uk', 'common', 'guests', 1)).toBe('1 гість');
    expect(render('uk', 'common', 'guests', 3)).toBe('3 гості');
    expect(render('uk', 'common', 'guests', 7)).toBe('7 гостей');
    expect(render('uk', 'common', 'seats', 2)).toBe('2 місця');
    expect(render('uk', 'common', 'seats', 6)).toBe('6 місць');
    expect(render('uk', 'order', 'drafts', 1)).toBe('1 нова позиція');
    expect(render('uk', 'order', 'drafts', 2)).toBe('2 нові позиції');
    expect(render('uk', 'order', 'drafts', 5)).toBe('5 нових позицій');
    expect(render('uk', 'tables', 'readyCount', 1)).toBe('1 страва готова');
    expect(render('uk', 'tables', 'readyCount', 3)).toBe('3 страви готові');
    expect(render('uk', 'tables', 'readyCount', 5)).toBe('5 страв готові');
  });
  it('English: one / other', () => {
    expect(render('en', 'common', 'items', 1)).toBe('1 item');
    expect(render('en', 'common', 'items', 3)).toBe('3 items');
    expect(render('en', 'common', 'items', 0)).toBe('0 items');
    expect(render('en', 'tables', 'readyCount', 1)).toBe('1 dish ready');
    expect(render('en', 'tables', 'readyCount', 2)).toBe('2 dishes ready');
  });
});

const flatten = (o: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );

describe('message catalogues', () => {
  it('uk and en define exactly the same keys', () => {
    const en = flatten(MESSAGES.en).sort();
    const uk = flatten(MESSAGES.uk).sort();
    expect(uk).toEqual(en);
  });
  it('no message is empty', () => {
    for (const loc of ['en', 'uk'] as const) {
      const flat = Object.fromEntries(
        flatten(MESSAGES[loc]).map((k) => [
          k,
          k.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown>)[p], MESSAGES[loc]),
        ]),
      );
      for (const [k, v] of Object.entries(flat))
        expect(String(v).trim(), `${loc}:${k}`).not.toBe('');
    }
  });
  it('plural messages carry the plural categories each language needs', () => {
    expect(MESSAGES.uk.common.items).toMatch(/one \{.*few \{.*many \{.*other \{/);
    expect(MESSAGES.en.common.items).toMatch(/one \{.*other \{/);
  });
  it('every placeholder used in en is also used in uk', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    for (const k of flatten(MESSAGES.en)) {
      const get = (loc: 'en' | 'uk') =>
        k
          .split('.')
          .reduce<unknown>((a, p) => (a as Record<string, unknown>)[p], MESSAGES[loc]) as string;
      expect(vars(get('uk')), k).toEqual(vars(get('en')));
    }
  });
});

describe('no Russian anywhere', () => {
  // Letters that exist in Russian but not in Ukrainian: ы э ъ ё (and capitals).
  const RUSSIAN_ONLY = /[ыэъёЫЭЪЁ]/;
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      if (f === 'node_modules' || f === '.next') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|json|css)$/.test(f) ? [p] : [];
    });
  it('the web sources and messages contain no Russian-only letters', () => {
    const root = path.resolve(__dirname, '..');
    const offenders = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'app'))]
      .filter((f) => !f.endsWith('i18n.test.tsx'))
      .filter((f) => RUSSIAN_ONLY.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('the Ukrainian catalogue uses Ukrainian letters (і, ї, є, ґ appear)', () => {
    const all = JSON.stringify(MESSAGES.uk);
    expect(all).toMatch(/[іїєґ]/);
    expect(all).not.toMatch(RUSSIAN_ONLY);
  });
});
