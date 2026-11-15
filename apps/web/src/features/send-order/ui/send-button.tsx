'use client';

import { useTranslations } from 'next-intl';
import type { Order } from '@app/shared';
import { draftCount, hasUnavailableDrafts } from '@/entities/order/model';
import { useOrderMutations } from '@/entities/order/mutations';
import { isApiError } from '@/shared/api/client';
import { useErrorMessage } from '@/shared/lib/error-message';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

export const SendButton = ({ order }: { order: Order }) => {
  const t = useTranslations('order');
  const message = useErrorMessage();
  const { send } = useOrderMutations(order.id);
  const drafts = draftCount(order);
  const blocked = hasUnavailableDrafts(order);
  // The server's detail texts are English; show our own, localised line per dish instead.
  const details =
    isApiError(send.error) && send.error.code === 'OUT_OF_STOCK' ? send.error.details : [];
  const dishNames = new Map(order.items.map((i) => [i.dishId, i.dishName]));
  return (
    <div className="flex flex-col gap-2">
      {send.error ? (
        <Alert tone="error">
          {message(send.error)}
          {details.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {details.map((d, i) => (
                <li key={i}>{t('outOfStockLine', { name: dishNames.get(d.path) ?? '…' })}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      <Button
        size="lg"
        disabled={drafts === 0 || blocked || send.isPending}
        onClick={() => send.mutate()}
      >
        {send.isPending
          ? t('sending')
          : drafts === 0
            ? t('nothingToSend')
            : `${t('send')} · ${t('drafts', { count: drafts })}`}
      </Button>
      {blocked ? <p className="text-sm text-muted-foreground">{t('removeUnavailable')}</p> : null}
    </div>
  );
};
