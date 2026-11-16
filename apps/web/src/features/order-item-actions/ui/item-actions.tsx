'use client';

import { useTranslations } from 'next-intl';
import type { OrderItem } from '@app/shared';
import { canRemove, canServe } from '@/entities/order/model';
import { useOrderMutations } from '@/entities/order/mutations';
import { useErrorMessage } from '@/shared/lib/error-message';
import { Button } from '@/shared/ui/button';

/** Per-item buttons for the owning waiter: remove/cancel (before cooking) and "served" (when ready). */
export const ItemActions = ({ orderId, item }: { orderId: string; item: OrderItem }) => {
  const t = useTranslations('order');
  const message = useErrorMessage();
  const { remove, serve } = useOrderMutations(orderId);
  const error = serve.error ?? remove.error;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {canServe(item.status) ? (
          <Button
            size="sm"
            variant="success"
            disabled={serve.isPending}
            onClick={() => serve.mutate(item.id)}
          >
            {t('serve')}
          </Button>
        ) : null}
        {canRemove(item.status) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={remove.isPending}
            onClick={() => remove.mutate(item.id)}
            aria-label={`${item.status === 'draft' ? t('remove') : t('cancelItem')}: ${item.dishName}`}
          >
            {item.status === 'draft' ? t('remove') : t('cancelItem')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="max-w-[16rem] text-right text-xs font-medium text-destructive">
          {message(error)}
        </p>
      ) : null}
    </div>
  );
};
