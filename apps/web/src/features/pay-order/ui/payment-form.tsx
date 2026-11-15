'use client';

import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { Order, PaymentResult } from '@app/shared';
import { usePayment } from '@/entities/order/mutations';
import { newId } from '@/shared/lib/ids';
import type { Locale } from '@/shared/i18n/routing';
import { useErrorMessage } from '@/shared/lib/error-message';
import { formatMoney, moneyToInput } from '@/shared/lib/money';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { evaluatePayment } from '../lib/payment-draft';

export const PaymentForm = ({
  order,
  suggestedAmount,
  label,
  onPaid,
}: {
  order: Order;
  /** Kopecks to prefill (a split part, or the whole remaining balance). */
  suggestedAmount: number;
  label?: string | undefined;
  onPaid?: (result: PaymentResult) => void;
}) => {
  const t = useTranslations('checkout');
  const locale = useLocale() as Locale;
  const message = useErrorMessage();
  const pay = usePayment(order.id);

  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [amountText, setAmountText] = useState(() => moneyToInput(suggestedAmount, locale));
  const [tenderedText, setTenderedText] = useState('');
  const [touched, setTouched] = useState(false);
  const [last, setLast] = useState<PaymentResult | null>(null);

  // Picking another part (or the remaining balance changing) re-fills the amount.
  useEffect(() => {
    setAmountText(moneyToInput(suggestedAmount, locale));
    setTouched(false);
  }, [suggestedAmount, locale]);

  const draft = evaluatePayment({ method, amountText, tenderedText }, order);

  /**
   * The payment id is the idempotency key. It stays the same while the request is "the same" (so a
   * double click or a retry after a dropped connection is one payment) and changes as soon as the
   * cashier edits anything that matters.
   */
  const idRef = useRef<{ key: string; id: string }>({ key: '', id: newId() });
  const key = `${method}|${draft.amount}|${draft.tendered}|${label ?? ''}`;
  if (idRef.current.key !== key) idRef.current = { key, id: newId() };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!draft.valid || draft.amount === null || pay.isPending) return;
    pay.mutate(
      {
        id: idRef.current.id,
        method,
        amount: draft.amount,
        ...(method === 'cash' && draft.tendered !== null ? { tendered: draft.tendered } : {}),
        ...(label ? { label } : {}),
      },
      {
        onSuccess: (result) => {
          setLast(result);
          setTenderedText('');
          idRef.current = { key: '', id: newId() };
          onPaid?.(result);
        },
      },
    );
  };

  const amountError = touched
    ? draft.problems.amount === 'invalid'
      ? t('amountInvalid')
      : draft.problems.amount === 'zero'
        ? t('amountZero')
        : draft.problems.amount === 'tooMuch'
          ? t('amountTooMuch', { remaining: formatMoney(order.remaining, locale) })
          : undefined
    : undefined;
  const tenderedError = touched
    ? draft.problems.tendered === 'invalid'
      ? t('amountInvalid')
      : draft.problems.tendered === 'low'
        ? t('tenderedLow')
        : undefined
    : undefined;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label={t('pay')}>
      {pay.retrying ? <Alert tone="warning">{t('retrying')}</Alert> : null}
      {pay.error && !pay.retrying ? <Alert tone="error">{message(pay.error)}</Alert> : null}
      {last && !last.replayed && last.payment.method === 'cash' && last.payment.change > 0 ? (
        <Alert tone="success">
          {t('changeGiven', { amount: formatMoney(last.payment.change, locale) })}
        </Alert>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t('method')}</legend>
        <div className="flex gap-2" role="radiogroup">
          {(['cash', 'card'] as const).map((m) => (
            <label
              key={m}
              className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${method === m ? 'border-primary bg-primary/10' : 'hover:bg-accent'}`}
            >
              <input
                type="radio"
                name="method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
                className="sr-only"
              />
              {m === 'cash' ? t('cash') : t('card')}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={t('amount')} error={amountError}>
        {(p) => (
          <Input
            {...p}
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
        )}
      </Field>

      {method === 'cash' ? (
        <>
          <Field label={t('tendered')} error={tenderedError}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                autoComplete="off"
                value={tenderedText}
                onChange={(e) => setTenderedText(e.target.value)}
              />
            )}
          </Field>
          <p aria-live="polite" className="text-lg font-semibold" data-testid="change">
            {draft.change !== null
              ? t('change', { amount: formatMoney(draft.change, locale) })
              : null}
          </p>
        </>
      ) : null}

      <Button type="submit" size="lg" disabled={pay.isPending || order.status === 'paid'}>
        {pay.isPending ? t('paying') : t('pay')}
      </Button>
    </form>
  );
};
