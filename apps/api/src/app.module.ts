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
import { HealthController } from './health/health.controller';
import type { Limiters } from './rate-limit/limiters';

@Module({})
export class AppModule {
  static register(env: Env, limiters: Limiters): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(env, limiters), DiscoveryModule, DbModule],
      controllers: [AuthController, HealthController],
      providers: [
        AuthService,
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_INTERCEPTOR, useClass: ValidationInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      global: true,
    };
  }
}
