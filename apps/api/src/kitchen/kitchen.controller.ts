import { Body, Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import { KitchenItem, KitchenPatchBody, KitchenQuery, KitchenResponse } from '@app/shared';
import { Endpoint } from '../common/endpoint';
import { KitchenService } from './kitchen.service';

@Controller()
export class KitchenController {
  constructor(@Inject(KitchenService) private readonly kitchen: KitchenService) {}

  @Get('kitchen')
  @Endpoint({
    access: ['cook'],
    tag: 'Kitchen',
    summary: 'Kitchen queue in the order items were sent. No prices or totals.',
    query: KitchenQuery,
    response: KitchenResponse,
  })
  async queue(@Query() q: KitchenQuery) {
    return { items: await this.kitchen.queue(q.station) };
  }

  @Patch('kitchen/items/:id')
  @Endpoint({
    access: ['cook'],
    tag: 'Kitchen',
    summary: 'Move an item sent → cooking → ready',
    body: KitchenPatchBody,
    response: KitchenItem,
  })
  advance(@Param('id') id: string, @Body() body: KitchenPatchBody) {
    return this.kitchen.advance(id, body.status);
  }
}
