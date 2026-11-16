'use client';

import { useTranslations } from 'next-intl';
import type { KitchenItem } from '@app/shared';
import { KitchenItemBody } from '@/entities/kitchen/ui/kitchen-item-body';
import { nextStatus } from '@/entities/kitchen/model';
import { useAdvanceItem } from '@/entities/kitchen/mutations';
import { KITCHEN_OVERDUE_MINUTES } from '@/shared/config';
import { cn } from '@/shared/lib/cn';
import { useErrorMessage } from '@/shared/lib/error-message';
import { isOverdue } from '@/shared/lib/time';

/**
 * The whole card is one big button: a click moves the item to the next step (sent → cooking → ready).
 * A real <button> gives keyboard operation (Tab, Enter, Space) for free.
 */
export const AdvanceItemButton = ({
  item,
  now,
  onConflict,
}: {
  item: KitchenItem;
  now: number;
  onConflict: () => void;
}) => {
  const t = useTranslations('kitchen');
  const message = useErrorMessage();
  const advance = useAdvanceItem(onConflict);
  const next = nextStatus(item.status);
  const overdue = isOverdue(item.sentAt, now, KITCHEN_OVERDUE_MINUTES);
  if (!next) return null;
  const action = next === 'cooking' ? t('tapStart') : t('tapFinish');
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={advance.isPending}
        onClick={() => advance.mutate({ id: item.id, status: next })}
        aria-label={`${action}: ${item.dishName}, ${t('table', { number: item.tableNumber })}`}
        data-overdue={overdue ? 'true' : 'false'}
        data-status={item.status}
        className={cn(
          'flex w-full flex-col gap-3 rounded-lg border-2 bg-card p-4 text-left transition-colors hover:bg-accent disabled:opacity-60',
          overdue
            ? 'border-destructive bg-destructive/10'
            : item.status === 'cooking'
              ? 'border-warning'
              : 'border-border',
        )}
      >
        <KitchenItemBody item={item} now={now} />
        <span className="text-sm font-semibold text-primary">{action} →</span>
      </button>
      {advance.error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {message(advance.error)}
        </p>
      ) : null}
    </div>
  );
};
