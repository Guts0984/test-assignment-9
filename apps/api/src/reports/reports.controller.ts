import { Controller, Get, Inject, Query } from '@nestjs/common';
import { revenueReport, type DbHandle } from '@app/db';
import { RevenueQuery, RevenueResponse } from '@app/shared';
import { Endpoint } from '../common/endpoint';
import { DB } from '../common/tokens';

@Controller()
export class ReportsController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get('reports/revenue')
  @Endpoint({
    access: ['manager'],
    tag: 'Reports',
    summary: 'Revenue per day and top dishes for a period of up to 60 days (YYYY-MM-DD, inclusive)',
    query: RevenueQuery,
    response: RevenueResponse,
  })
  revenue(@Query() q: RevenueQuery) {
    return revenueReport(this.handle.db, q.from, q.to);
  }
}
