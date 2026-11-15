'use client';

import { Suspense } from 'react';
import { AppShell } from '@/widgets/app-shell';
import { RevenueDashboard } from '@/widgets/revenue-dashboard';

export const ManagerReportsPage = () => (
  <AppShell roles={['manager']}>
    {/* useSearchParams needs a Suspense boundary */}
    <Suspense>
      <RevenueDashboard />
    </Suspense>
  </AppShell>
);
