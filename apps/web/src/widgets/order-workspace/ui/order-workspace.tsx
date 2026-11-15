'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Dish } from '@app/shared';
import { useMenu } from '@/entities/dish/model';
import { useOrder, useStale, setStale } from '@/entities/order';
import { useMe } from '@/entities/session/model';
import { AddItemDialog } from '@/features/add-order-item';
import { useIsLive } from '@/features/realtime-sync';
import { isApiError } from '@/shared/api/client';
import { Link } from '@/shared/i18n/navigation';
import { useErrorMessage } from '@/shared/lib/error-message';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Spinner } from '@/shared/ui/spinner';
import { CheckoutPanel } from './checkout-panel';
import { MenuPanel } from './menu-panel';
import { OrderPanel } from './order-panel';

/** The waiter's screen for one check: menu on the left, the check on the right, payment on demand. */
export const OrderWorkspace = ({ orderId }: { orderId: string }) => {
  const t = useTranslations('order');
  const c = useTranslations('checkout');
  const common = useTranslations('common');
  const message = useErrorMessage();
  const live = useIsLive();
  const order = useOrder(orderId, live);
  const menu = useMenu(live);
  const me = useMe().data;
  const stale = useStale(orderId);
  const [picked, setPicked] = useState<Dish | null>(null);
  const [paying, setPaying] = useState(false);

  if (order.isLoading) return <Spinner label={common('loading')} />;
  if (order.error || !order.data) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="error">{message(order.error)}</Alert>
        <Button asChild variant="outline" className="self-start">
          <Link href="/tables">{common('back')}</Link>
        </Button>
      </div>
    );
  }
  const o = order.data;
  const mine = me?.id === o.waiterId;
  const editable = mine && o.status === 'open';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/tables">← {common('back')}</Link>
        </Button>
        <h1 className="text-2xl font-bold">{t('title', { number: o.number })}</h1>
      </div>

      {stale ? (
        <Alert tone="warning">
          {t('reloaded')}{' '}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => setStale(orderId, false)}
          >
            {common('close')}
          </button>
        </Alert>
      ) : null}
      {o.status === 'paid' ? <Alert tone="success">{t('paidBanner')}</Alert> : null}
      {!mine && o.status === 'open' ? <Alert tone="info">{t('readOnly')}</Alert> : null}
      {menu.error && !isApiError(menu.error) ? (
        <Alert tone="error">{message(menu.error)}</Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <MenuPanel dishes={menu.data ?? []} disabled={!editable} onPick={setPicked} />
        <OrderPanel order={o} editable={editable} onCheckout={() => setPaying(true)} />
      </div>

      <AddItemDialog dish={picked} order={o} onClose={() => setPicked(null)} />

      <Dialog open={paying} onOpenChange={setPaying}>
        <DialogContent closeLabel={common('close')} className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {c('title')} · {t('title', { number: o.number })}
            </DialogTitle>
          </DialogHeader>
          <CheckoutPanel order={o} />
        </DialogContent>
      </Dialog>
    </div>
  );
};
