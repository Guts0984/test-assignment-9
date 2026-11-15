'use client';

import { AppShell } from '@/widgets/app-shell';
import { KitchenBoard } from '@/widgets/kitchen-board';

export const KitchenPage = () => (
  <AppShell roles={['cook']}>
    <KitchenBoard />
  </AppShell>
);
