'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Order } from '@app/shared';
import { useOrderMutations } from '@/entities/order/mutations';
import { useRouter } from '@/shared/i18n/navigation';
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

/** A check with nothing to bill (opened by mistake, or every item cancelled) can be closed to free the table. */
export const CloseEmptyButton = ({ order }: { order: Order }) => {
  const t = useTranslations('order');
  const common = useTranslations('common');
  const message = useErrorMessage();
  const router = useRouter();
  const { close } = useOrderMutations(order.id);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        {t('closeEmpty')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={common('close')}>
          <DialogHeader>
            <DialogTitle>{t('closeEmptyTitle')}</DialogTitle>
            <DialogDescription>{t('closeEmptyText')}</DialogDescription>
          </DialogHeader>
          {close.error ? <Alert tone="error">{message(close.error)}</Alert> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {common('cancel')}
            </Button>
            <Button
              disabled={close.isPending}
              onClick={() =>
                close.mutate(undefined, {
                  onSuccess: () => {
                    setOpen(false);
                    router.push('/tables');
                  },
                })
              }
            >
              {t('closeEmptyConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
