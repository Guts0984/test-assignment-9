import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { type DbHandle, type Queryable, dishes, modifierGroups, modifiers } from '@app/db';
import type { AppEvent, Dish, DishCreate, DishPatch } from '@app/shared';
import { notFound } from '../common/errors';
import { DB } from '../common/tokens';
import { EventsService } from '../events/events.service';
import { loadDishes } from './menu.queries';

type Groups = DishCreate['modifierGroups'];

const insertGroups = async (tx: Queryable, dishId: string, groups: Groups): Promise<void> => {
  for (const [gi, g] of groups.entries()) {
    const [row] = await tx
      .insert(modifierGroups)
      .values({ dishId, name: g.name, min: g.min, max: g.max, position: gi })
      .returning({ id: modifierGroups.id });
    if (!row) throw new Error('modifier group insert returned no row');
    await tx.insert(modifiers).values(
      g.modifiers.map((m, mi) => ({
        groupId: row.id,
        name: m.name,
        surcharge: m.surcharge,
        position: mi,
      })),
    );
  }
};

/**
 * Brings the dish's groups and modifiers to the submitted state WITHOUT recreating what stays: a group or
 * modifier that is submitted with its id keeps that id (open order dialogs and past order lines keep
 * pointing at it). Ids that do not belong to this dish are ignored and the entry is created as new.
 */
const syncGroups = async (tx: Queryable, dishId: string, groups: Groups): Promise<void> => {
  const existing = await tx.select().from(modifierGroups).where(eq(modifierGroups.dishId, dishId));
  const existingGroupIds = new Set(existing.map((g) => g.id));
  const existingMods = existing.length
    ? await tx
        .select()
        .from(modifiers)
        .where(
          inArray(
            modifiers.groupId,
            existing.map((g) => g.id),
          ),
        )
    : [];
  const modsByGroup = new Map<string, Set<string>>();
  for (const m of existingMods) {
    const set = modsByGroup.get(m.groupId) ?? new Set<string>();
    set.add(m.id);
    modsByGroup.set(m.groupId, set);
  }

  const keptGroupIds: string[] = [];
  for (const [gi, g] of groups.entries()) {
    let groupId: string;
    if (g.id !== undefined && existingGroupIds.has(g.id)) {
      groupId = g.id;
      await tx
        .update(modifierGroups)
        .set({ name: g.name, min: g.min, max: g.max, position: gi })
        .where(eq(modifierGroups.id, groupId));
    } else {
      const [row] = await tx
        .insert(modifierGroups)
        .values({ dishId, name: g.name, min: g.min, max: g.max, position: gi })
        .returning({ id: modifierGroups.id });
      if (!row) throw new Error('modifier group insert returned no row');
      groupId = row.id;
    }
    keptGroupIds.push(groupId);

    const ownMods = modsByGroup.get(groupId) ?? new Set<string>();
    const keptModIds: string[] = [];
    for (const [mi, m] of g.modifiers.entries()) {
      if (m.id !== undefined && ownMods.has(m.id)) {
        keptModIds.push(m.id);
        await tx
          .update(modifiers)
          .set({ name: m.name, surcharge: m.surcharge, position: mi })
          .where(eq(modifiers.id, m.id));
      } else {
        const [row] = await tx
          .insert(modifiers)
          .values({ groupId, name: m.name, surcharge: m.surcharge, position: mi })
          .returning({ id: modifiers.id });
        if (!row) throw new Error('modifier insert returned no row');
        keptModIds.push(row.id);
      }
    }
    // modifiers the manager removed (order lines keep their own name/price snapshot)
    await tx
      .delete(modifiers)
      .where(and(eq(modifiers.groupId, groupId), notInArray(modifiers.id, keptModIds)));
  }
  // groups the manager removed (their modifiers cascade)
  if (keptGroupIds.length === 0) {
    await tx.delete(modifierGroups).where(eq(modifierGroups.dishId, dishId));
  } else {
    await tx
      .delete(modifierGroups)
      .where(and(eq(modifierGroups.dishId, dishId), notInArray(modifierGroups.id, keptGroupIds)));
  }
};

@Injectable()
export class MenuService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  list(includeArchived: boolean): Promise<Dish[]> {
    return loadDishes(this.handle.db, { includeArchived });
  }

  async get(id: string): Promise<Dish> {
    const [dish] = await loadDishes(this.handle.db, { ids: [id], includeArchived: true });
    if (!dish) throw notFound('Dish');
    return dish;
  }

  async create(input: DishCreate): Promise<Dish> {
    const id = await this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(dishes)
        .values({
          name: input.name,
          category: input.category,
          price: input.price,
          station: input.station,
          stock: input.stock,
        })
        .returning({ id: dishes.id });
      if (!row) throw new Error('dish insert returned no row');
      await insertGroups(tx, row.id, input.modifierGroups);
      return row.id;
    });
    this.events.emit({ type: 'menu.changed' });
    return this.get(id);
  }

  async patch(id: string, patch: DishPatch): Promise<Dish> {
    const events: AppEvent[] = [{ type: 'menu.changed' }];
    await this.handle.db.transaction(async (tx) => {
      const [before] = await tx.select().from(dishes).where(eq(dishes.id, id)).for('update');
      if (!before) throw notFound('Dish');
      const { modifierGroups: groups, ...fields } = patch;
      await tx
        .update(dishes)
        .set({
          ...fields,
          // A hand-made stock change ends the validity of every portion taken earlier (see returnStock).
          ...(fields.stock !== undefined ? { stockEpoch: sql`${dishes.stockEpoch} + 1` } : {}),
          updatedAt: new Date(),
        })
        .where(eq(dishes.id, id));
      if (groups) {
        await syncGroups(tx, id, groups);
      }
      const wasStopped = before.stock === 0;
      const nowStopped = fields.stock === undefined ? wasStopped : fields.stock === 0;
      if (wasStopped !== nowStopped) {
        events.push({ type: 'stoplist.changed', dishId: id, stopListed: nowStopped });
      }
    });
    this.events.emit(...events);
    return this.get(id);
  }

  /** Soft delete: past bills keep referencing the dish. */
  async archive(id: string): Promise<Dish> {
    const rows = await this.handle.db
      .update(dishes)
      .set({ archived: true, updatedAt: new Date() })
      .where(eq(dishes.id, id))
      .returning({ id: dishes.id });
    if (rows.length === 0) throw notFound('Dish');
    this.events.emit(
      { type: 'menu.changed' },
      { type: 'stoplist.changed', dishId: id, stopListed: true },
    );
    return this.get(id);
  }
}
