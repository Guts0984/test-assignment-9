import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(dishes.id, id));
      if (groups) {
        await tx.delete(modifierGroups).where(eq(modifierGroups.dishId, id)); // modifiers cascade
        await insertGroups(tx, id, groups);
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
