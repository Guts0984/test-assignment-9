'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { LIMITS, type Table } from '@app/shared';
import { openOrder } from '@/entities/order/api';
import { keys } from '@/shared/api/query-keys';
import { useErrorMessage } from '@/shared/lib/error-message';
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
import { Input } from '@/shared/ui/input';

/**
 * The form lives in its own component and is keyed by the table: opening another table (or the same one
 * again) starts from a clean form — default guest count, no leftover error from the previous attempt.
 */
const OpenTableForm = ({
  table,
  onOpenChange,
  onOpened,
}: {
  table: Table;
  onOpenChange: (open: boolean) => void;
  onOpened: (orderId: string) => void;
}) => {
  const t = useTranslations('tables');
  const common = useTranslations('common');
  const message = useErrorMessage();
  const qc = useQueryClient();

  const schema = z.object({
    guests: z.coerce
      .number({ invalid_type_error: t('guestsRange') })
      .int(t('guestsRange'))
      .min(1, t('guestsRange'))
      .max(LIMITS.maxGuests, t('guestsRange')),
  });
  type In = z.input<typeof schema>;
  const form = useForm<In, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { guests: 2 },
  });

  const mutation = useMutation({
    mutationFn: (guests: number) => openOrder({ tableId: table.id, guests }),
    onSuccess: (order) => {
      void qc.invalidateQueries({ queryKey: keys.tables });
      onOpened(order.id);
    },
    onError: () => void qc.invalidateQueries({ queryKey: keys.tables }),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('openTitle', { number: table.number })}</DialogTitle>
        <DialogDescription>{common('seats', { count: table.seats })}</DialogDescription>
      </DialogHeader>
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v.guests))}
        noValidate
        className="flex flex-col gap-4"
      >
        {mutation.error ? <Alert tone="error">{message(mutation.error)}</Alert> : null}
        <Field label={t('guestsLabel')} error={form.formState.errors.guests?.message}>
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="numeric"
              min={1}
              max={LIMITS.maxGuests}
              autoFocus
              {...form.register('guests')}
            />
          )}
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {common('cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('opening') : t('open')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};

export const OpenTableDialog = ({
  table,
  onOpenChange,
  onOpened,
}: {
  table: Table | null;
  onOpenChange: (open: boolean) => void;
  onOpened: (orderId: string) => void;
}) => {
  const common = useTranslations('common');
  return (
    <Dialog open={table !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={common('close')}>
        {table ? (
          <OpenTableForm
            key={table.id}
            table={table}
            onOpenChange={onOpenChange}
            onOpened={onOpened}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
