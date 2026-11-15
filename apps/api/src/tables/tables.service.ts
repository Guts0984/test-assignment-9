import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DbHandle } from '@app/db';
import type { Table } from '@app/shared';
import { DB } from '../common/tokens';

type Row = {
  id: string;
  number: number;
  seats: number;
  order_id: string | null;
  waiter_id: string | null;
  ready: string;
};

@Injectable()
export class TablesService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async list(): Promise<Table[]> {
    const r = await this.handle.db.execute<Row>(sql`
      select t.id, t.number, t.seats, o.id as order_id, o.waiter_id,
             (select count(*) from order_items i where i.order_id = o.id and i.status = 'ready')::text as ready
      from restaurant_tables t
      left join orders o on o.table_id = t.id and o.status = 'open'
      order by t.number
    `);
    return r.rows.map((x) => {
      const readyCount = Number(x.ready);
      return {
        id: x.id,
        number: x.number,
        seats: x.seats,
        state: x.order_id === null ? 'free' : readyCount > 0 ? 'ready' : 'occupied',
        orderId: x.order_id,
        waiterId: x.waiter_id,
        readyCount,
      };
    });
  }
}
