'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { Order } from '@app/shared';
import { groupByGuest } from '@/entities/order/model';
import { StatusBadge } from '@/entities/order/ui/status-badge';
import { CloseEmptyButton } from '@/features/close-order';
import { ItemActions } from '@/features/order-item-actions';
import { SendButton } from '@/features/send-order';
import type { Locale } from '@/shared/i18n/routing';
import { cn } from '@/shared/lib/cn';
import { formatMoney } from '@/shared/lib/money';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

/** The check: items by guest with live statuses, totals, "send to kitchen" and the way to payment. */
export const OrderPanel = ({
  order,
  editable,
  onCheckout,
}: {
  order: Order;
  editable: boolean;
  onCheckout: () => void;
}) => {
  const t = useTranslations('order');
  const common = useTranslations('common');
  const locale = useLocale() as Locale;
  const groups = groupByGuest(order.items);
  const money = (n: number) => formatMoney(n, locale);

  return (
    <section aria-labelledby="check-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="check-title" className="text-lg font-semibold">
          {t('yourCheck')}
        </h2>
        <span className="text-sm text-muted-foreground">
          {common('guests', { count: order.guests })} · {t('version', { version: order.version })}
        </span>
      </div>

      {order.items.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {t('noItems')}
        </p>
      ) : null}

      {groups.map((g) => (
        <div key={g.guest} className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {common('guest', { n: g.guest })}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {g.items.map((i) => (
              <li
                key={i.id}
                data-status={i.status}
                className={cn(
                  'flex flex-col gap-1 rounded-md border bg-card p-2.5',
                  i.status === 'cancelled' && 'opacity-60',
                  i.unavailable && 'border-destructive',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={cn('font-medium', i.status === 'cancelled' && 'line-through')}>
                    {i.dishName}
                  </span>
                  <span className="tabular-nums">{money(i.unitPrice)}</span>
                </div>
                {i.modifiers.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {i.modifiers.map((m) => m.name).join(', ')}
                  </p>
                ) : null}
                {i.comment ? <p className="text-sm italic">“{i.comment}”</p> : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={i.status} />
                    {i.unavailable ? <Badge tone="danger">{t('unavailable')}</Badge> : null}
                  </div>
                  {editable && order.status === 'open' ? (
                    <ItemActions orderId={order.id} item={i} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <dl className="mt-1 flex flex-col gap-1 border-t pt-3">
        <div className="flex justify-between text-sm">
          <dt>{t('subtotal')}</dt>
          <dd className="tabular-nums" data-testid="subtotal">
            {money(order.subtotal)}
          </dd>
        </div>
        {order.serviceFee > 0 ? (
          <div className="flex justify-between text-sm">
            <dt>{t('serviceFee')}</dt>
            <dd className="tabular-nums" data-testid="service-fee">
              {money(order.serviceFee)}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between text-lg font-bold">
          <dt>{t('total')}</dt>
          <dd className="tabular-nums" data-testid="total">
            {money(order.total)}
          </dd>
        </div>
      </dl>

      {editable && order.status === 'open' ? (
        <>
          <SendButton order={order} />
          {order.total === 0 && order.payments.length === 0 ? (
            <CloseEmptyButton order={order} />
          ) : (
            <Button variant="secondary" size="lg" onClick={onCheckout}>
              {t('checkout')}
            </Button>
          )}
        </>
      ) : null}
    </section>
  );
};
