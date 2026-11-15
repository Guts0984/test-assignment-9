'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  type Order,
  type SplitBody,
  type SplitResult,
  LIMITS,
  allocateByWeights,
  splitByGuests,
  splitEqual,
} from '@app/shared';
import { splitOrder } from '@/entities/order/api';
import type { Locale } from '@/shared/i18n/routing';
import { cn } from '@/shared/lib/cn';
import { formatMoney } from '@/shared/lib/money';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

export type SplitMode = 'whole' | 'equal' | 'guests';

/** The split computed on the device with the shared money functions (instant, works offline). */
export const localSplit = (
  order: Pick<Order, 'items' | 'guests' | 'total' | 'serviceFee'>,
  body: SplitBody,
): SplitResult => {
  if (body.mode === 'guests') {
    const parts = splitByGuests(order.items, order.guests);
    return {
      mode: 'guests',
      total: order.total,
      parts: parts.map((p, i) => ({
        index: i + 1,
        guest: p.guest,
        subtotal: p.subtotal,
        serviceFee: p.serviceFee,
        total: p.total,
      })),
    };
  }
  const totals = splitEqual(order.total, body.parts);
  const fees = allocateByWeights(order.serviceFee, totals);
  return {
    mode: 'equal',
    total: order.total,
    parts: totals.map((total, i) => ({
      index: i + 1,
      guest: null,
      subtotal: total - (fees[i] ?? 0),
      serviceFee: fees[i] ?? 0,
      total,
    })),
  };
};

/**
 * Which parts are already covered by the payments so far, assuming parts are paid in order.
 * (The server keeps no per-part state: a split is just a way to pick the next amount.)
 */
export const paidPartFlags = (
  parts: readonly { total: number }[],
  paidAmount: number,
): boolean[] => {
  let running = 0;
  return parts.map((p) => {
    running += p.total;
    return running <= paidAmount;
  });
};

export const SplitPanel = ({
  order,
  onPick,
}: {
  order: Order;
  /** Called with the amount (kopecks) and a label when the waiter chooses a part to pay. */
  onPick: (amount: number, label: string) => void;
}) => {
  const t = useTranslations('checkout');
  const common = useTranslations('common');
  const locale = useLocale() as Locale;
  const [mode, setMode] = useState<SplitMode>('whole');
  const [partsText, setPartsText] = useState('3');
  const parts = Number(partsText);
  const partsValid = Number.isInteger(parts) && parts >= 2 && parts <= LIMITS.maxSplitParts;

  const body: SplitBody | null =
    mode === 'guests'
      ? { mode: 'guests' }
      : mode === 'equal' && partsValid
        ? { mode: 'equal', parts }
        : null;

  // The server is the authority (same numbers, stateless).
  const query = useQuery({
    queryKey: ['split', order.id, order.version, body],
    enabled: body !== null && order.total > 0,
    queryFn: () => splitOrder(order.id, body as SplitBody),
  });
  // Shown at once from the local calculation; replaced by the server's answer when it arrives, and
  // kept if the server cannot be reached (the numbers come from the same shared functions).
  const result = body ? (query.data ?? localSplit(order, body)) : undefined;
  const paid = result ? paidPartFlags(result.parts, order.paidAmount) : [];

  return (
    <section aria-labelledby="split-title" className="flex flex-col gap-3">
      <h3 id="split-title" className="text-sm font-semibold">
        {t('title')}
      </h3>
      <div role="radiogroup" aria-label={t('title')} className="flex flex-wrap gap-2">
        {(['whole', 'equal', 'guests'] as const).map((m) => (
          <label
            key={m}
            className={cn(
              'cursor-pointer rounded-md border px-3 py-2 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              mode === m ? 'border-primary bg-primary/10' : 'hover:bg-accent',
            )}
          >
            <input
              type="radio"
              name="split-mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              className="sr-only"
            />
            {m === 'whole' ? t('whole') : m === 'equal' ? t('equal') : t('perGuest')}
          </label>
        ))}
      </div>

      {mode === 'equal' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="split-parts" className="text-sm font-medium">
            {t('partsLabel')}
          </label>
          <Input
            id="split-parts"
            type="number"
            inputMode="numeric"
            min={2}
            max={LIMITS.maxSplitParts}
            value={partsText}
            aria-invalid={!partsValid}
            aria-describedby={partsValid ? undefined : 'split-parts-error'}
            onChange={(e) => setPartsText(e.target.value)}
            className="w-32"
          />
          {!partsValid ? (
            <p id="split-parts-error" role="alert" className="text-sm font-medium text-destructive">
              {t('partsRange')}
            </p>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-1.5" data-testid="split-parts">
            {result.parts.map((p, i) => (
              <li
                key={p.index}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  {p.guest !== null ? common('guest', { n: p.guest }) : t('part', { n: p.index })}
                </span>
                <span className="flex items-center gap-3">
                  <strong data-testid="part-total">{formatMoney(p.total, locale)}</strong>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={paid[i] || order.status === 'paid'}
                    onClick={() =>
                      onPick(
                        Math.min(p.total, order.remaining),
                        p.guest !== null
                          ? common('guest', { n: p.guest })
                          : t('part', { n: p.index }),
                      )
                    }
                  >
                    {paid[i] ? t('partPaid') : t('payThis')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t('splitSum', {
              total: formatMoney(
                result.parts.reduce((a, p) => a + p.total, 0),
                locale,
              ),
            })}
          </p>
        </div>
      ) : null}
    </section>
  );
};
