'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Station } from '@app/shared';
import { useKitchen, useNow } from '@/entities/kitchen/model';
import { AdvanceItemButton } from '@/features/advance-kitchen-item';
import { useIsLive } from '@/features/realtime-sync';
import { useErrorMessage } from '@/shared/lib/error-message';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Spinner } from '@/shared/ui/spinner';

/** Items in the order they were sent. New items and cancellations arrive live. */
export const KitchenBoard = () => {
  const t = useTranslations('kitchen');
  const common = useTranslations('common');
  const message = useErrorMessage();
  const live = useIsLive();
  const kitchen = useKitchen(live);
  const now = useNow();
  const [station, setStation] = useState<Station | 'all'>('all');
  const [conflict, setConflict] = useState(false);

  if (kitchen.isLoading) return <Spinner label={common('loading')} />;
  if (kitchen.error) return <Alert tone="error">{message(kitchen.error)}</Alert>;
  const all = kitchen.data ?? [];
  const items = station === 'all' ? all : all.filter((i) => i.station === station);

  return (
    <section aria-labelledby="kitchen-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="kitchen-title" className="text-2xl font-bold">
          {t('title')}
        </h1>
        <div
          role="group"
          aria-label={t('stations')}
          className="flex overflow-hidden rounded-md border"
        >
          {(['all', 'kitchen', 'bar'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={station === s}
              onClick={() => setStation(s)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium',
                station === s ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              {s === 'all'
                ? t('stationAll')
                : s === 'kitchen'
                  ? t('stationKitchen')
                  : t('stationBar')}
            </button>
          ))}
        </div>
      </div>
      {conflict ? (
        <Alert tone="warning">
          {t('conflict')}{' '}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => setConflict(false)}
          >
            {common('close')}
          </button>
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="kitchen-list">
          {items.map((item) => (
            <li key={item.id}>
              <AdvanceItemButton item={item} now={now} onConflict={() => setConflict(true)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
