import { sql } from 'drizzle-orm';
import { BILLABLE_STATUSES, type RevenueResponse } from '@app/shared';
import type { Queryable } from './client';

type DayRow = { day: string; revenue: string; orders: string };
type DishRow = { dish_id: string; name: string; quantity: string; revenue: string };

/**
 * Revenue and top dishes for `from`…`to` (inclusive business days). Two index-backed aggregations.
 * Revenue is attributed to the business day the check was opened; the service fee is part of it.
 */
export const revenueReport = async (
  db: Queryable,
  from: string,
  to: string,
  topLimit = 10,
): Promise<RevenueResponse> => {
  const days = await db.execute<DayRow>(sql`
    select day::text as day, sum(total)::bigint as revenue, count(*)::bigint as orders
    from orders
    where status = 'paid' and day between ${from}::date and ${to}::date
    group by day
    order by day
  `);
  const statuses = sql.join(
    BILLABLE_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const top = await db.execute<DishRow>(sql`
    select oi.dish_id, oi.dish_name as name, count(*)::bigint as quantity, sum(oi.unit_price)::bigint as revenue
    from orders o
    join order_items oi on oi.order_id = o.id
    where o.status = 'paid'
      and o.day between ${from}::date and ${to}::date
      and oi.status::text in (${statuses})
    group by oi.dish_id, oi.dish_name
    order by sum(oi.unit_price) desc, oi.dish_name
    limit ${topLimit}
  `);
  const dayRows = days.rows.map((r) => ({
    day: r.day,
    revenue: Number(r.revenue),
    orders: Number(r.orders),
  }));
  return {
    from,
    to,
    total: dayRows.reduce((a, d) => a + d.revenue, 0),
    orders: dayRows.reduce((a, d) => a + d.orders, 0),
    days: dayRows,
    topDishes: top.rows.map((r) => ({
      dishId: r.dish_id,
      name: r.name,
      quantity: Number(r.quantity),
      revenue: Number(r.revenue),
    })),
  };
};
