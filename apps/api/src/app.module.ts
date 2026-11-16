import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AccessGuard } from './common/access.guard';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ConfigModule } from './config.module';
import { ValidationInterceptor } from './common/validation.interceptor';
import { DbModule } from './db/db.module';
import type { Env } from './env';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { KitchenController } from './kitchen/kitchen.controller';
import { KitchenService } from './kitchen/kitchen.service';
import { MenuController } from './menu/menu.controller';
import { MenuService } from './menu/menu.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { ReportsController } from './reports/reports.controller';
import { TablesController } from './tables/tables.controller';
import { TablesService } from './tables/tables.service';
import { ConfigController, HealthController } from './health/health.controller';
import type { Limiters } from './rate-limit/limiters';

@Module({})
export class AppModule {
  static register(env: Env, limiters: Limiters): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(env, limiters), DiscoveryModule, DbModule],
      controllers: [
        AuthController,
        HealthController,
        ConfigController,
        MenuController,
        TablesController,
        OrdersController,
        KitchenController,
        EventsController,
        ReportsController,
      ],
      providers: [
        AuthService,
        EventsService,
        MenuService,
        TablesService,
        OrdersService,
        KitchenService,
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_INTERCEPTOR, useClass: ValidationInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      global: true,
    };
  }
}
