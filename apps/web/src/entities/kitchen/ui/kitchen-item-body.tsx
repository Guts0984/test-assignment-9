'use client';

import { useTranslations } from 'next-intl';
import type { KitchenItem } from '@app/shared';
import { KITCHEN_OVERDUE_MINUTES } from '@/shared/config';
import { cn } from '@/shared/lib/cn';
import { formatElapsed, isOverdue } from '@/shared/lib/time';
import { Badge } from '@/shared/ui/badge';

/** What a cook sees for one item. No prices: the API does not send them. */
export const KitchenItemBody = ({ item, now }: { item: KitchenItem; now: number }) => {
  const t = useTranslations('kitchen');
  const overdue = isOverdue(item.sentAt, now, KITCHEN_OVERDUE_MINUTES);
  return (
    <div className="flex flex-col gap-2 text-left">
      <div className="flex items-start justify-between gap-2">
        <span className="text-lg font-bold">{t('table', { number: item.tableNumber })}</span>
        <div className="flex items-center gap-1.5">
          {overdue ? (
            <Badge tone="danger">{t('overdue', { minutes: KITCHEN_OVERDUE_MINUTES })}</Badge>
          ) : null}
          <Badge tone={item.status === 'cooking' ? 'warning' : 'neutral'}>
            {t(`state.${item.status === 'cooking' ? 'cooking' : 'sent'}`)}
          </Badge>
        </div>
      </div>
      <div className="text-xl font-semibold leading-tight">{item.dishName}</div>
      {item.modifiers.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {item.modifiers.map((m) => (
            <li key={m} className="rounded bg-secondary px-2 py-0.5 text-sm">
              {m}
            </li>
          ))}
        </ul>
      ) : null}
      {item.comment ? (
        <p className="rounded bg-warning/20 px-2 py-1 text-sm font-medium">“{item.comment}”</p>
      ) : null}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {t('check', { number: item.orderNumber })} · {t('guest', { n: item.guest })}
        </span>
        <span
          className={cn(
            'font-mono text-base font-semibold tabular-nums',
            overdue ? 'text-destructive' : 'text-foreground',
          )}
          data-testid="timer"
        >
          {formatElapsed(item.sentAt, now)}
        </span>
      </div>
    </div>
  );
};
