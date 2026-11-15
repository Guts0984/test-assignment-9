'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Order } from '@app/shared';
import { hasDrafts } from '@/entities/order/model';
import { PaymentForm } from '@/features/pay-order';
import { SplitPanel } from '@/features/split-bill';
import { Link } from '@/shared/i18n/navigation';
import type { Locale } from '@/shared/i18n/routing';
import { formatMoney } from '@/shared/lib/money';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className={`flex justify-between gap-4 ${strong ? 'text-lg font-bold' : 'text-sm'}`}>
    <dt>{label}</dt>
    <dd className="tabular-nums">{value}</dd>
  </div>
);

/** Settling the check: totals, split (equal / per guest), cash or card payments, change. */
export const CheckoutPanel = ({ order }: { order: Order }) => {
  const t = useTranslations('checkout');
  const o = useTranslations('order');
  const locale = useLocale() as Locale;
  const [pick, setPick] = useState<{ amount: number; label?: string } | null>(null);
  const money = (n: number) => formatMoney(n, locale);

  if (order.status === 'paid') {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{t('paidDone')}</Alert>
        <dl className="flex flex-col gap-1">
          <Row label={o('total')} value={money(order.total)} strong />
        </dl>
        <PaymentHistory order={order} />
        <Button asChild variant="outline">
          <Link href="/tables">{t('backToTables')}</Link>
        </Button>
      </div>
    );
  }

  const suggested = pick ? Math.min(pick.amount, order.remaining) : order.remaining;

  return (
    <div className="flex flex-col gap-5">
      <dl className="flex flex-col gap-1">
        <Row label={o('subtotal')} value={money(order.subtotal)} />
        {order.serviceFee > 0 ? (
          <Row label={o('serviceFee')} value={money(order.serviceFee)} />
        ) : null}
        <Row label={o('total')} value={money(order.total)} strong />
        {order.paidAmount > 0 ? (
          <Row label={o('paidTotal')} value={money(order.paidAmount)} />
        ) : null}
        <Row label={o('remaining')} value={money(order.remaining)} strong />
      </dl>

      {hasDrafts(order) ? <Alert tone="warning">{t('unsentDrafts')}</Alert> : null}
      {order.total === 0 ? <Alert tone="info">{t('nothingToPay')}</Alert> : null}

      {order.total > 0 ? (
        <>
          <SplitPanel order={order} onPick={(amount, label) => setPick({ amount, label })} />
          <PaymentForm
            order={order}
            suggestedAmount={suggested}
            label={pick?.label}
            onPaid={() => setPick(null)}
          />
        </>
      ) : null}
      <PaymentHistory order={order} />
    </div>
  );
};

const PaymentHistory = ({ order }: { order: Order }) => {
  const t = useTranslations('checkout');
  const locale = useLocale() as Locale;
  if (order.payments.length === 0) return null;
  return (
    <section aria-labelledby="payments-title">
      <h3 id="payments-title" className="mb-1 text-sm font-semibold">
        {t('history')}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        {order.payments.map((p) => (
          <li key={p.id} className="flex justify-between gap-3 rounded border px-3 py-1.5">
            <span>
              {p.method === 'cash' ? t('cashShort') : t('cardShort')}
              {p.label ? ` · ${p.label}` : ''}
            </span>
            <span className="tabular-nums">
              {formatMoney(p.amount, locale)}
              {p.method === 'cash' && p.change > 0
                ? ` (${t('change', { amount: formatMoney(p.change, locale) })})`
                : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};
