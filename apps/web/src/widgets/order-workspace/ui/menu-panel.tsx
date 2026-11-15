'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { Dish } from '@app/shared';
import { groupByCategory } from '@/entities/dish/model';
import type { Locale } from '@/shared/i18n/routing';
import { cn } from '@/shared/lib/cn';
import { formatMoney } from '@/shared/lib/money';
import { Badge } from '@/shared/ui/badge';
import { Input } from '@/shared/ui/input';

/** The menu by category. Stop-listed dishes are visibly disabled. */
export const MenuPanel = ({
  dishes,
  disabled,
  onPick,
}: {
  dishes: readonly Dish[];
  disabled: boolean;
  onPick: (dish: Dish) => void;
}) => {
  const t = useTranslations('order');
  const locale = useLocale() as Locale;
  const [category, setCategory] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => groupByCategory(dishes), [dishes]);
  const q = filter.trim().toLowerCase();
  const visible = groups
    .filter((g) => category === null || g.category === category)
    .map((g) => ({
      ...g,
      dishes: g.dishes.filter((d) => q === '' || d.name.toLowerCase().includes(q)),
    }))
    .filter((g) => g.dishes.length > 0);

  return (
    <section aria-labelledby="menu-title" className="flex flex-col gap-3">
      <h2 id="menu-title" className="text-lg font-semibold">
        {t('menu')}
      </h2>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('menu')}>
        {[null, ...groups.map((g) => g.category)].map((c) => (
          <button
            key={c ?? '__all'}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              category === c
                ? 'border-primary bg-primary text-primary-foreground'
                : 'hover:bg-accent',
            )}
          >
            {c ?? t('allCategories')}
          </button>
        ))}
      </div>
      <Input
        type="search"
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchPlaceholder')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {visible.map((g) => (
        <div key={g.category} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">{g.category}</h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {g.dishes.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  disabled={disabled || d.stopListed}
                  onClick={() => onPick(d)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`${d.name}, ${formatMoney(d.price, locale)}${d.stopListed ? `, ${t('stopList')}` : ''}`}
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatMoney(d.price, locale)}
                    </span>
                  </span>
                  {d.stopListed ? <Badge tone="danger">{t('stopList')}</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};
