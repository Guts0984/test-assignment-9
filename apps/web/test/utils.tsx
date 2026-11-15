import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { makeQueryClient } from '@/app/providers/query-provider';
import en from '@/shared/i18n/messages/en.json';
import uk from '@/shared/i18n/messages/uk.json';

export const MESSAGES = { en, uk } as const;
export type TestLocale = keyof typeof MESSAGES;

export const renderApp = (
  ui: ReactElement,
  opts: { locale?: TestLocale } & Omit<RenderOptions, 'wrapper'> = {},
) => {
  const { locale = 'en', ...rest } = opts;
  const client = makeQueryClient();
  client.setDefaultOptions({
    queries: { retry: false, staleTime: 0 },
    mutations: { retry: false },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Kyiv">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
  return { client, ...render(ui, { wrapper: Wrapper, ...rest }) };
};

type Handler = (url: string, init: RequestInit | undefined) => unknown | Promise<unknown>;

/** Replaces fetch with a scriptable fake that answers like the API (JSON envelope for errors). */
export const mockFetch = (handler: Handler) => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    const result = await handler(url, init);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
};

export const apiError = (status: number, code: string, message = code, details: unknown[] = []) =>
  new Response(JSON.stringify({ error: { code, message, requestId: 'test', details } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// ---- fixtures ----------------------------------------------------------------------------------
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const id = uuid;

export const makeOrder = (over: Record<string, unknown> = {}) => ({
  id: uuid(100),
  number: 7,
  day: '2025-06-01',
  tableId: uuid(1),
  waiterId: uuid(2),
  guests: 2,
  status: 'open',
  version: 3,
  items: [],
  subtotal: 0,
  serviceFee: 0,
  total: 0,
  paidAmount: 0,
  remaining: 0,
  payments: [],
  createdAt: '2025-06-01T10:00:00.000Z',
  paidAt: null,
  ...over,
});

export const makeItem = (n: number, over: Record<string, unknown> = {}) => ({
  id: uuid(200 + n),
  dishId: uuid(300 + n),
  dishName: `Dish ${n}`,
  guest: 1,
  status: 'sent',
  comment: '',
  modifiers: [],
  unitPrice: 10000,
  unavailable: false,
  createdAt: '2025-06-01T10:00:00.000Z',
  sentAt: '2025-06-01T10:01:00.000Z',
  ...over,
});

export const steak = () => ({
  id: uuid(500),
  name: 'Steak',
  category: 'Mains',
  price: 25000,
  station: 'kitchen' as const,
  stock: null,
  stopListed: false,
  archived: false,
  modifierGroups: [
    {
      id: uuid(510),
      name: 'Doneness',
      min: 1,
      max: 1,
      modifiers: [
        { id: uuid(511), name: 'Rare', surcharge: 0 },
        { id: uuid(512), name: 'Medium', surcharge: 0 },
        { id: uuid(513), name: 'Well done', surcharge: 0 },
      ],
    },
    {
      id: uuid(520),
      name: 'Extras',
      min: 0,
      max: 3,
      modifiers: [
        { id: uuid(521), name: 'Bacon', surcharge: 3500 },
        { id: uuid(522), name: 'Egg', surcharge: 2000 },
        { id: uuid(523), name: 'Cheese', surcharge: 2500 },
        { id: uuid(524), name: 'Mushrooms', surcharge: 1500 },
      ],
    },
  ],
});
