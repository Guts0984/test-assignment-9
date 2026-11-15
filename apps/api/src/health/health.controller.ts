import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DbHandle } from '@app/db';
import { z } from 'zod';
import { Endpoint } from '../common/endpoint';
import { AppError } from '../common/errors';
import { DB } from '../common/tokens';

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
