'use client';

import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LIMITS, type Order } from '@app/shared';
import { useOrderMutations } from '@/entities/order/mutations';
import { useErrorMessage } from '@/shared/lib/error-message';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

/** "N guests" with − / +: a 6th guest sits down, and the service fee starts to apply. */
export const GuestsControl = ({ order, editable }: { order: Order; editable: boolean }) => {
  const t = useTranslations('order');
  const common = useTranslations('common');
  const message = useErrorMessage();
  const { setGuests } = useOrderMutations(order.id);
  const highestUsed = Math.max(
    0,
    ...order.items.filter((i) => i.status !== 'cancelled').map((i) => i.guest),
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {editable ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t('guestsLess')}
            disabled={setGuests.isPending || order.guests <= Math.max(1, highestUsed)}
            onClick={() => setGuests.mutate(order.guests - 1)}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
        <span className="min-w-[5rem] text-center text-sm text-muted-foreground" aria-live="polite">
          {common('guests', { count: order.guests })}
        </span>
        {editable ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t('guestsMore')}
            disabled={setGuests.isPending || order.guests >= LIMITS.maxGuests}
            onClick={() => setGuests.mutate(order.guests + 1)}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
      </div>
      {setGuests.error ? <Alert tone="error">{message(setGuests.error)}</Alert> : null}
    </div>
  );
};
