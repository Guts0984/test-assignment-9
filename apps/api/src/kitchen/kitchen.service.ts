import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DbHandle } from '@app/db';
import type { KitchenItem, Station } from '@app/shared';
import { conflict, notFound } from '../common/errors';
import { DB } from '../common/tokens';
import { EventsService } from '../events/events.service';

type Row = {
  id: string;
  order_id: string;
  table_id: string;
  order_number: number;
  table_number: number;
  dish_name: string;
  station: Station;
  comment: string;
  guest: number;
  status: KitchenItem['status'];
  sent_at: Date;
  modifiers: string[];
};

const base = sql`
  select i.id, i.order_id, o.table_id, o.number as order_number, t.number as table_number,
         i.dish_name, i.station::text as station, i.comment, i.guest, i.status::text as status, i.sent_at,
         coalesce((select array_agg(m.name order by m.name) from order_item_modifiers m where m.item_id = i.id), '{}') as modifiers
  from order_items i
  join orders o on o.id = i.order_id
  join restaurant_tables t on t.id = o.table_id`;

const toItem = (r: Row): KitchenItem => ({
  id: r.id,
  orderNumber: r.order_number,
  tableNumber: r.table_number,
  dishName: r.dish_name,
  station: r.station,
  modifiers: r.modifiers,
  comment: r.comment,
  guest: r.guest,
  status: r.status,
  sentAt: new Date(r.sent_at).toISOString(),
});

@Injectable()
export class KitchenService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** Items waiting or in progress, oldest first. Contains no prices and no check totals. */
  async queue(station?: Station): Promise<KitchenItem[]> {
    const stationFilter = station ? sql`and i.station = ${station}` : sql``;
    const r = await this.handle.db.execute<Row>(sql`
      ${base}
      where i.status in ('sent', 'cooking') ${stationFilter}
      order by i.sent_at asc, i.id asc`);
    return r.rows.map(toItem);
  }

  private async one(id: string): Promise<Row | undefined> {
    const r = await this.handle.db.execute<Row>(sql`${base} where i.id = ${id}`);
    return r.rows[0];
  }

  /** sent → cooking → ready, nothing else. Compare-and-set, so a concurrent cancel can't be overwritten. */
  async advance(id: string, next: 'cooking' | 'ready'): Promise<KitchenItem> {
    const prev = next === 'cooking' ? 'sent' : 'cooking';
    const stamp = next === 'cooking' ? sql`cooking_at = now()` : sql`ready_at = now()`;
    const changed = await this.handle.db.execute<{ id: string }>(sql`
      update order_items set status = ${next}::item_status, ${stamp}
      where id = ${id} and status = ${prev}::item_status
      returning id`);
    const row = await this.one(id);
    if (!row) throw notFound('Item');
    if (changed.rows.length === 0) {
      throw conflict(
        `Item is "${row.status}"; it must be "${prev}" to become "${next}"`,
        'INVALID_TRANSITION',
      );
    }
    this.events.emit(
      { type: 'item.changed', orderId: row.order_id, itemId: id, status: next },
      { type: 'table.changed', tableId: row.table_id },
    );
    return toItem(row);
  }
}
