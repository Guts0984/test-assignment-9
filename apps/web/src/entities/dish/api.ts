import { Dish, type DishCreate, type DishPatch, MenuResponse } from '@app/shared';
import { request } from '@/shared/api/client';

export const fetchMenu = async (includeArchived = false) =>
  (await request(`/menu${includeArchived ? '?includeArchived=true' : ''}`, MenuResponse)).dishes;
export const createDish = (body: DishCreate) =>
  request('/dishes', Dish, { method: 'POST', json: body });
export const patchDish = (id: string, body: DishPatch) =>
  request(`/dishes/${id}`, Dish, { method: 'PATCH', json: body });
export const archiveDish = (id: string) => request(`/dishes/${id}`, Dish, { method: 'DELETE' });
