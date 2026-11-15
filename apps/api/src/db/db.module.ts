import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type DbHandle } from '@app/db';
import { DB, ENV } from '../common/tokens';
import type { Env } from '../env';

class DbLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}
  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env): DbHandle =>
        createDb(env.DATABASE_URL, { max: env.DB_POOL_MAX, applicationName: 'api' }),
    },
    DbLifecycle,
  ],
  exports: [DB],
})
export class DbModule {}
