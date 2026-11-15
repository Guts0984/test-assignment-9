import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  Dish,
  DishCreate,
  DishPatch,
  MenuQuery,
  MenuResponse,
  type DishCreate as DishCreateInput,
  type DishPatch as DishPatchInput,
} from '@app/shared';
import { Endpoint } from '../common/endpoint';
import type { AppRequest } from '../common/request';
import { MenuService } from './menu.service';

@Controller()
export class MenuController {
  constructor(@Inject(MenuService) private readonly menu: MenuService) {}

  @Get('menu')
  @Endpoint({
    access: ['waiter', 'manager'],
    tag: 'Menu',
    summary: 'Menu with modifier groups and stock (stock 0 = stop-list, null = unlimited)',
    query: MenuQuery,
    response: MenuResponse,
  })
  async list(@Query() query: z.infer<typeof MenuQuery>, @Req() req: AppRequest) {
    // Archived dishes are a management concern.
    const includeArchived = query.includeArchived && req.user?.role === 'manager';
    return { dishes: await this.menu.list(includeArchived) };
  }

  @Get('dishes/:id')
  @Endpoint({ access: ['waiter', 'manager'], tag: 'Menu', summary: 'One dish', response: Dish })
  get(@Param('id') id: string) {
    return this.menu.get(id);
  }

  @Post('dishes')
  @Endpoint({
    access: ['manager'],
    tag: 'Menu',
    summary: 'Create a dish with modifier groups',
    body: DishCreate,
    response: Dish,
    status: 201,
  })
  create(@Body() body: DishCreateInput) {
    return this.menu.create(body);
  }

  @Patch('dishes/:id')
  @Endpoint({
    access: ['manager'],
    tag: 'Menu',
    summary: 'Update a dish, its modifier groups or its stock (null = unlimited, 0 = stop-list)',
    body: DishPatch,
    response: Dish,
  })
  patch(@Param('id') id: string, @Body() body: DishPatchInput) {
    return this.menu.patch(id, body);
  }

  @Delete('dishes/:id')
  @Endpoint({
    access: ['manager'],
    tag: 'Menu',
    summary: 'Remove a dish from the menu (soft delete, history is kept)',
    response: Dish,
  })
  remove(@Param('id') id: string) {
    return this.menu.archive(id);
  }
}
