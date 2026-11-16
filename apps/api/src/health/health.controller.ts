import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DbHandle } from '@app/db';
import { z } from 'zod';
import { AppConfig, businessDayOf } from '@app/shared';
import { Endpoint } from '../common/endpoint';
import { AppError } from '../common/errors';
import { DB, ENV } from '../common/tokens';
import type { Env } from '../env';

@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get('health')
  @Endpoint({
    access: 'public',
    tag: 'System',
    summary: 'Liveness + database check',
    response: z.object({ status: z.literal('ok') }),
  })
  async health(): Promise<{ status: 'ok' }> {
    try {
      await this.handle.db.execute(sql`select 1`);
    } catch {
      throw new AppError(503, 'INTERNAL', 'Database unavailable');
    }
    return { status: 'ok' };
  }
}

@Controller()
export class ConfigController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('config')
  @Endpoint({
    access: 'public',
    tag: 'System',
    summary: 'Restaurant time zone, when the business day starts, and the current business day',
    response: AppConfig,
  })
  config(): AppConfig {
    return {
      timeZone: this.env.RESTAURANT_TZ,
      dayStartHour: this.env.RESTAURANT_DAY_START_HOUR,
      today: businessDayOf(new Date(), this.env.RESTAURANT_TZ, this.env.RESTAURANT_DAY_START_HOUR),
    };
  }
}
