'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Dish } from '@app/shared';
import { useDishMutations } from '@/entities/dish/mutations';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

export const ArchiveDishButton = ({ dish }: { dish: Dish }) => {
  const t = useTranslations('menu');
  const common = useTranslations('common');
  const { archive } = useDishMutations();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`${t('archive')}: ${dish.name}`}
      >
        {t('archive')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={common('close')}>
          <DialogHeader>
            <DialogTitle>{t('archive')}</DialogTitle>
            <DialogDescription>{t('archiveConfirm', { name: dish.name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {common('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={archive.isPending}
              onClick={() => archive.mutate(dish.id, { onSuccess: () => setOpen(false) })}
            >
              {t('archive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
