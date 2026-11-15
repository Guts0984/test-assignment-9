'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/shared/i18n/navigation';
import { routing } from '@/shared/i18n/routing';
import { cn } from '@/shared/lib/cn';

const LABEL: Record<string, string> = { en: 'EN', uk: 'УК' };

export const LocaleSwitcher = () => {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div role="group" aria-label={t('language')} className="flex overflow-hidden rounded-md border">
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          onClick={() => {
            // Keep the query string (e.g. the report period) when switching language.
            const search = typeof window === 'undefined' ? '' : window.location.search;
            router.replace(`${pathname}${search}`, { locale: l });
          }}
          className={cn(
            'px-2.5 py-1 text-sm font-medium',
            l === locale ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
          )}
        >
          {LABEL[l] ?? l}
        </button>
      ))}
    </div>
  );
};
