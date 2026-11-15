'use client';

import { AppShell } from '@/widgets/app-shell';
import { MenuManager } from '@/widgets/menu-manager';

export const ManagerMenuPage = () => (
  <AppShell roles={['manager']}>
    <MenuManager />
  </AppShell>
);
