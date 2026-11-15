'use client';

import { useTranslations } from 'next-intl';
import type { ItemStatus } from '@app/shared';
import { Badge } from '@/shared/ui/badge';

const TONE = {
  draft: 'outline',
  sent: 'neutral',
  cooking: 'warning',
  ready: 'success',
  served: 'neutral',
  cancelled: 'danger',
} as const satisfies Record<ItemStatus, 'outline' | 'neutral' | 'warning' | 'success' | 'danger'>;

export const StatusBadge = ({ status }: { status: ItemStatus }) => {
  const t = useTranslations('order.status');
  return <Badge tone={TONE[status]}>{t(status)}</Badge>;
};
