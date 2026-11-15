import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  AddItemBody,
  OpenOrderBody,
  Order,
  PaymentBody,
  PaymentResult,
  SendBody,
  ServeBody,
  SplitBody,
  SplitResult,
  VersionQuery,
} from '@app/shared';
import { Endpoint } from '../common/endpoint';
import { unauthenticated } from '../common/errors';
import type { AppRequest, AppResponse, AuthUser } from '../common/request';
import { OrdersService } from './orders.service';

const user = (req: AppRequest): AuthUser => {
  if (!req.user) throw unauthenticated();
  return req.user;
};

@Controller()
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post('orders')
  @Endpoint({
    access: ['waiter'],
    tag: 'Orders',
    summary: 'Open a check on a table (gets the next daily number)',
    body: OpenOrderBody,
    response: Order,
    status: 201,
  })
  open(@Body() body: OpenOrderBody, @Req() req: AppRequest) {
    return this.orders.open(user(req), body);
  }

  @Get('orders/:id')
  @Endpoint({
    access: ['waiter', 'manager'],
    tag: 'Orders',
    summary: 'A check with items, totals and payments',
    response: Order,
  })
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Post('orders/:id/items')
  @Endpoint({
    access: ['waiter'],
    tag: 'Orders',
    summary: 'Add a draft item (own checks only). 409 if the check changed or was paid meanwhile.',
    body: AddItemBody,
    response: Order,
    status: 201,
  })
  addItem(@Param('id') id: string, @Body() body: AddItemBody, @Req() req: AppRequest) {
    return this.orders.addItem(user(req), id, body);
  }

  @Delete('orders/:id/items/:itemId')
  @Endpoint({
    access: ['waiter'],
    tag: 'Orders',
    summary:
      'Remove a draft item, or cancel a sent one before cooking starts (the portion returns to stock)',
    query: VersionQuery,
    response: Order,
  })
  removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Query() q: VersionQuery,
    @Req() req: AppRequest,
  ) {
    return this.orders.removeItem(user(req), id, itemId, q.expectedVersion);
  }

  @Patch('orders/:id/items/:itemId')
  @Endpoint({
    access: ['waiter'],
    tag: 'Orders',
    summary: 'Mark a ready item as served',
    body: ServeBody,
    response: Order,
  })
  serve(@Param('id') id: string, @Param('itemId') itemId: string, @Req() req: AppRequest) {
    return this.orders.serve(user(req), id, itemId);
  }

  @Post('orders/:id/send')
  @HttpCode(200)
  @Endpoint({
    access: ['waiter'],
    tag: 'Orders',
    summary:
      'Send draft items to the kitchen; takes portions from stock atomically (all or nothing)',
    body: SendBody,
    response: Order,
  })
  send(@Param('id') id: string, @Body() body: SendBody, @Req() req: AppRequest) {
    return this.orders.send(user(req), id, body.expectedVersion);
  }

  @Post('orders/:id/split')
  @HttpCode(200)
  @Endpoint({
    access: ['waiter', 'manager'],
    tag: 'Payments',
    summary: 'Preview a split bill: equal parts or per guest. Always sums to the check total.',
    body: SplitBody,
    response: SplitResult,
  })
  split(@Param('id') id: string, @Body() body: SplitBody) {
    return this.orders.split(id, body);
  }

  @Post('orders/:id/payments')
  @Endpoint({
    access: ['waiter'],
    tag: 'Payments',
    summary:
      'Record a cash (with change) or card payment. The client-generated payment id makes it idempotent: a repeat returns the original (200, replayed: true).',
    body: PaymentBody,
    response: PaymentResult,
    status: 201,
  })
  async pay(
    @Param('id') id: string,
    @Body() body: PaymentBody,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: AppResponse,
  ) {
    const result = await this.orders.pay(user(req), id, body);
    res.status(result.replayed ? 200 : 201);
    return result;
  }
}
