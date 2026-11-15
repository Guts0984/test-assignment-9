import { and, asc, eq, inArray } from 'drizzle-orm';
import { type Queryable, dishes, modifierGroups, modifiers } from '@app/db';
import type { Dish } from '@app/shared';

export type LoadDishesOptions = { ids?: string[]; includeArchived?: boolean };

/** Loads dishes with their modifier groups and modifiers (3 queries, no N+1). */
export const loadDishes = async (q: Queryable, opts: LoadDishesOptions = {}): Promise<Dish[]> => {
  const filters = [];
  if (!opts.includeArchived) filters.push(eq(dishes.archived, false));
  if (opts.ids) {
    if (opts.ids.length === 0) return [];
    filters.push(inArray(dishes.id, opts.ids));
  }
  const dishRows = await q
    .select()
    .from(dishes)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(dishes.category), asc(dishes.name), asc(dishes.id));
  if (dishRows.length === 0) return [];

  const ids = dishRows.map((d) => d.id);
  const groupRows = await q
    .select()
    .from(modifierGroups)
    .where(inArray(modifierGroups.dishId, ids))
    .orderBy(asc(modifierGroups.position), asc(modifierGroups.id));
  const modRows =
    groupRows.length === 0
      ? []
      : await q
          .select()
          .from(modifiers)
          .where(
            inArray(
              modifiers.groupId,
              groupRows.map((g) => g.id),
            ),
          )
          .orderBy(asc(modifiers.position), asc(modifiers.id));

  return dishRows.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    price: d.price,
    station: d.station,
    stock: d.stock,
    stopListed: d.stock === 0,
    archived: d.archived,
    modifierGroups: groupRows
      .filter((g) => g.dishId === d.id)
      .map((g) => ({
        id: g.id,
        name: g.name,
        min: g.min,
        max: g.max,
        modifiers: modRows
          .filter((m) => m.groupId === g.id)
          .map((m) => ({ id: m.id, name: m.name, surcharge: m.surcharge })),
      })),
  }));
};
