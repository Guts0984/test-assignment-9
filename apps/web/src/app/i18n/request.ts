import { getRequestConfig } from 'next-intl/server';
import { TIME_ZONE } from '@/shared/config';
import { isLocale, routing } from '@/shared/i18n/routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : routing.defaultLocale;
  const messages = (await import(`@/shared/i18n/messages/${locale}.json`)).default as Record<
    string,
    unknown
  >;
  return { locale, messages, timeZone: TIME_ZONE };
});
