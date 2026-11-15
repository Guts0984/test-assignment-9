'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Dish } from '@app/shared';
import { groupByCategory } from '@/entities/dish/model';
import { useMenu } from '@/entities/dish/model';
import { ArchiveDishButton, DishFormDialog, StockControl } from '@/features/manage-dish';
import { useIsLive } from '@/features/realtime-sync';
import type { Locale } from '@/shared/i18n/routing';
import { useErrorMessage } from '@/shared/lib/error-message';
import { formatMoney } from '@/shared/lib/money';
import { Alert } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';

/** The manager's menu: dishes, modifier rules and portions left. */
export const MenuManager = () => {
  const t = useTranslations('menu');
  const common = useTranslations('common');
  const locale = useLocale() as Locale;
  const message = useErrorMessage();
  const live = useIsLive();
  const menu = useMenu(live);
  const [editing, setEditing] = useState<{ dish: Dish | null } | null>(null);

  if (menu.isLoading) return <Spinner label={common('loading')} />;
  if (menu.error) return <Alert tone="error">{message(menu.error)}</Alert>;
  const groups = groupByCategory(menu.data ?? []);

  return (
    <section aria-labelledby="menu-title" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 id="menu-title" className="text-2xl font-bold">
          {t('title')}
        </h1>
        <Button onClick={() => setEditing({ dish: null })}>{t('add')}</Button>
      </div>
      {groups.length === 0 ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      {groups.map((g) => (
        <div key={g.category} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {g.category}
          </h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-muted text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    {t('name')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t('price')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t('station')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t('stock')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">{t('edit')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.dishes.map((d) => (
                  <tr key={d.id} className="border-t align-middle">
                    <td className="px-3 py-2">
                      <div className="font-medium">{d.name}</div>
                      {d.modifierGroups.length > 0 ? (
                        <div className="text-xs text-muted-foreground">
                          {d.modifierGroups
                            .map((mg) => `${mg.name} ${mg.min}–${mg.max}`)
                            .join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(d.price, locale)}</td>
                    <td className="px-3 py-2">
                      {d.station === 'bar' ? t('stationBar') : t('stationKitchen')}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <StockControl key={`${d.id}-${d.stock}`} dish={d} />
                        {d.stopListed ? (
                          <Badge tone="danger">{t('stopListed')}</Badge>
                        ) : d.stock !== null ? (
                          <Badge tone="neutral">{t('left', { count: d.stock })}</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing({ dish: d })}
                          aria-label={`${t('edit')}: ${d.name}`}
                        >
                          {t('edit')}
                        </Button>
                        <ArchiveDishButton dish={d} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <DishFormDialog
        dish={editing?.dish ?? null}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </section>
  );
};
