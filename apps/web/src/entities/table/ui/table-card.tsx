'use client';

import { useTranslations } from 'next-intl';
import type { Table } from '@app/shared';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';

const STATE_STYLE = {
  free: 'border-border',
  occupied: 'border-primary',
  ready: 'border-success ring-2 ring-success',
} as const;

/** The visual card for one table. Interaction (click, link) is decided by the caller. */
export const TableCardBody = ({ table, mine }: { table: Table; mine: boolean }) => {
  const t = useTranslations('tables');
  const common = useTranslations('common');
  return (
    <div
      className={cn(
        'flex h-full min-h-[120px] flex-col justify-between gap-2 rounded-lg border-2 bg-card p-4 text-left',
        STATE_STYLE[table.state],
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-bold">{t('table', { number: table.number })}</span>
        <Badge
          tone={table.state === 'free' ? 'neutral' : table.state === 'ready' ? 'success' : 'info'}
        >
          {t(table.state)}
        </Badge>
      </div>
      <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
        <span>{common('seats', { count: table.seats })}</span>
        {table.state === 'ready' ? (
          <span className="font-medium text-success">
            {t('readyCount', { count: table.readyCount })}
          </span>
        ) : null}
        {table.state !== 'free' ? <span>{mine ? t('mine') : t('otherWaiter')}</span> : null}
      </div>
    </div>
  );
};
