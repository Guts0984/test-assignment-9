'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { type Dish, LIMITS, type Order } from '@app/shared';
import { checkModifierSelection, surchargeOf, toggleModifier } from '@/entities/dish/model';
import { useOrderMutations } from '@/entities/order/mutations';
import type { Locale } from '@/shared/i18n/routing';
import { useErrorMessage } from '@/shared/lib/error-message';
import { formatMoney } from '@/shared/lib/money';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { Select, Textarea } from '@/shared/ui/input';
import { ModifierPicker } from './modifier-picker';

export const AddItemDialog = ({
  dish,
  order,
  onClose,
}: {
  dish: Dish | null;
  order: Order;
  onClose: () => void;
}) => {
  const t = useTranslations('picker');
  const common = useTranslations('common');
  const message = useErrorMessage();
  const locale = useLocale() as Locale;
  const { add } = useOrderMutations(order.id);

  const schema = z.object({
    guest: z.coerce.number().int().min(1).max(order.guests),
    comment: z.string().max(LIMITS.maxCommentLength, t('commentTooLong')),
  });
  type In = z.input<typeof schema>;
  const form = useForm<In, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { guest: 1, comment: '' },
  });

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [showErrors, setShowErrors] = useState(false);

  // Fresh state every time a different dish is opened.
  useEffect(() => {
    setSelected(new Set());
    setShowErrors(false);
    add.reset();
    form.reset({ guest: 1, comment: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dish changes
  }, [dish?.id]);

  if (!dish) return null;
  const groups = dish.modifierGroups;
  const price = dish.price + surchargeOf(groups, selected);

  const submit = form.handleSubmit((v) => {
    if (checkModifierSelection(groups, selected).length > 0) {
      setShowErrors(true);
      // Move focus to the first group that needs attention.
      const first = checkModifierSelection(groups, selected)[0];
      document
        .getElementById(`group-${first?.groupId}-error`)
        ?.closest('fieldset')
        ?.querySelector('input')
        ?.focus();
      return;
    }
    add.mutate(
      { dishId: dish.id, guest: v.guest, comment: v.comment, modifierIds: [...selected] },
      { onSuccess: onClose },
    );
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={common('close')}>
        <DialogHeader>
          <DialogTitle>{dish.name}</DialogTitle>
          <DialogDescription>
            {t('price')}: {formatMoney(price, locale)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {add.error ? <Alert tone="error">{message(add.error)}</Alert> : null}
          <Field label={t('guest')} error={form.formState.errors.guest?.message}>
            {(p) => (
              <Select {...p} {...form.register('guest')}>
                {Array.from({ length: order.guests }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {common('guest', { n })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <ModifierPicker
            groups={groups}
            selected={selected}
            showErrors={showErrors}
            onToggle={(id) => setSelected((s) => toggleModifier(groups, s, id))}
          />
          <Field label={t('comment')} error={form.formState.errors.comment?.message}>
            {(p) => (
              <Textarea
                {...p}
                maxLength={LIMITS.maxCommentLength + 50}
                {...form.register('comment')}
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? t('adding') : `${t('addToCheck')} · ${formatMoney(price, locale)}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
