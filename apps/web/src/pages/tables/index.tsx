'use client';

import { AppShell } from '@/widgets/app-shell';
import { TablesBoard } from '@/widgets/tables-board';

export const TablesPage = () => (
  <AppShell roles={['waiter']}>
    <TablesBoard />
  </AppShell>
);
