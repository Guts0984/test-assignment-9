'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Dish } from '@app/shared';
import { LIMITS } from '@app/shared';
import { useDishMutations } from '@/entities/dish/mutations';
import { useErrorMessage } from '@/shared/lib/error-message';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

/** Inline "portions left" editor: a number, empty = unlimited, 0 = stop-list. */
export const StockControl = ({ dish }: { dish: Dish }) => {
  const t = useTranslations('menu');
  const message = useErrorMessage();
  const { patch } = useDishMutations();
  const [text, setText] = useState(dish.stock === null ? '' : String(dish.stock));
  const valid =
    text.trim() === '' || (/^\d{1,6}$/.test(text.trim()) && Number(text) <= LIMITS.maxStock);
  const apply = (stock: number | null) => patch.mutate({ id: dish.id, body: { stock } });
  return (
    <div className="flex items-center gap-1.5">
      <Input
        aria-label={`${t('stock')}: ${dish.name}`}
        aria-invalid={!valid}
        value={text}
        placeholder={t('unlimited')}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && valid) apply(text.trim() === '' ? null : Number(text));
        }}
        className="h-9 w-28"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!valid || patch.isPending}
        onClick={() => apply(text.trim() === '' ? null : Number(text))}
      >
        {t('setStock')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={patch.isPending}
        onClick={() => {
          setText('0');
          apply(0);
        }}
      >
        {t('stopNow')}
      </Button>
      {patch.error ? (
        <span role="alert" className="text-xs text-destructive">
          {message(patch.error)}
        </span>
      ) : null}
    </div>
  );
};
