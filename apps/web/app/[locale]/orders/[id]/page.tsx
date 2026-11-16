import { notFound } from 'next/navigation';
import { OrderPage } from '@/pages/order';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // /orders/foo is simply not a page (not "please check the highlighted fields")
  if (!UUID.test(id)) notFound();
  return <OrderPage orderId={id} />;
}
