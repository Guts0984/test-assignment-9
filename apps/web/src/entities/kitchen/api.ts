import { KitchenItem, type KitchenPatchBody, KitchenResponse, type Station } from '@app/shared';
import { request } from '@/shared/api/client';

export const fetchKitchen = async (station?: Station) =>
  (await request(`/kitchen${station ? `?station=${station}` : ''}`, KitchenResponse)).items;
export const advanceItem = (id: string, status: KitchenPatchBody['status']) =>
  request(`/kitchen/items/${id}`, KitchenItem, { method: 'PATCH', json: { status } });
