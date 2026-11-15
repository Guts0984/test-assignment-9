import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'uk'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];
export const isLocale = (v: string): v is Locale =>
  (routing.locales as readonly string[]).includes(v);
