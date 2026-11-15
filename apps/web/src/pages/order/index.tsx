'use client';

import { AppShell } from '@/widgets/app-shell';
import { OrderWorkspace } from '@/widgets/order-workspace';

export const OrderPage = ({ orderId }: { orderId: string }) => (
  <AppShell roles={['waiter', 'manager']}>
    <OrderWorkspace orderId={orderId} />
  </AppShell>
);
