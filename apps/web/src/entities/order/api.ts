import {
  type AddItemBody,
  Order,
  type OpenOrderBody,
  type PaymentBody,
  PaymentResult,
  type SplitBody,
  SplitResult,
} from '@app/shared';
import { request } from '@/shared/api/client';

export const fetchOrder = (id: string) => request(`/orders/${id}`, Order);
export const openOrder = (body: OpenOrderBody) =>
  request('/orders', Order, { method: 'POST', json: body });
export const addItem = (id: string, body: AddItemBody) =>
  request(`/orders/${id}/items`, Order, { method: 'POST', json: body });
export const removeItem = (id: string, itemId: string, expectedVersion: number) =>
  request(`/orders/${id}/items/${itemId}?expectedVersion=${expectedVersion}`, Order, {
    method: 'DELETE',
  });
export const sendOrder = (id: string, expectedVersion: number) =>
  request(`/orders/${id}/send`, Order, { method: 'POST', json: { expectedVersion } });
export const serveItem = (id: string, itemId: string) =>
  request(`/orders/${id}/items/${itemId}`, Order, { method: 'PATCH', json: { status: 'served' } });
export const splitOrder = (id: string, body: SplitBody) =>
  request(`/orders/${id}/split`, SplitResult, { method: 'POST', json: body });
export const payOrder = (id: string, body: PaymentBody) =>
  request(`/orders/${id}/payments`, PaymentResult, { method: 'POST', json: body });
