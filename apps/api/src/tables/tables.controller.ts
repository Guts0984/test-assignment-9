import { Controller, Get, Inject } from '@nestjs/common';
import { TablesResponse } from '@app/shared';
import { Endpoint } from '../common/endpoint';
import { TablesService } from './tables.service';

@Controller()
export class TablesController {
  constructor(@Inject(TablesService) private readonly tables: TablesService) {}

  @Get('tables')
  @Endpoint({
    access: ['waiter', 'manager'],
    tag: 'Tables',
    summary: 'Tables with state: free, occupied, or ready (has dishes ready to serve)',
    response: TablesResponse,
  })
  async list() {
    return { tables: await this.tables.list() };
  }
}
