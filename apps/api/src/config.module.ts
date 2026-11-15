import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ENV, RATE_LIMITERS } from './common/tokens';
import type { Env } from './env';
import type { Limiters } from './rate-limit/limiters';

/** Makes the parsed environment and the shared rate limiters injectable everywhere. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env, limiters: Limiters): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: RATE_LIMITERS, useValue: limiters },
      ],
      exports: [ENV, RATE_LIMITERS],
    };
  }
}
