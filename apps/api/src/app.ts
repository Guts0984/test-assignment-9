import 'reflect-metadata';
import { json } from 'express';
import { NestFactory, DiscoveryService } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import {
  accessLog,
  middlewareErrors,
  rateLimit,
  requestId,
  securityHeaders,
} from './common/middleware';
import { cookieName } from './auth/session';
import type { Env } from './env';
import { buildOpenApi } from './openapi/build';
import { listRoutes } from './openapi/routes';
import { createLimiters, type Limiters } from './rate-limit/limiters';

export type CreatedApp = { app: NestExpressApplication; limiters: Limiters };

/** Builds the fully configured application. Used by main.ts and by tests (real server, real port). */
export const createApp = async (env: Env): Promise<CreatedApp> => {
  const limiters = createLimiters(env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env, limiters), {
    bodyParser: false,
    logger:
      env.LOG_LEVEL === 'silent'
        ? false
        : [env.LOG_LEVEL === 'log' ? 'log' : env.LOG_LEVEL, 'error', 'warn'],
  });

  app.disable('x-powered-by');
  // Only peers listed in TRUSTED_PROXIES may set X-Forwarded-For; everyone else is judged by socket IP.
  app.set('trust proxy', env.TRUSTED_PROXIES.length > 0 ? env.TRUSTED_PROXIES : false);
  app.set('query parser', 'simple'); // no nested objects/arrays from ?a[b]=c tricks
  app.set('etag', false);

  app.use(requestId());
  app.use(securityHeaders());
  if (env.LOG_LEVEL !== 'silent') app.use(accessLog((line) => console.log(line)));
  app.use(rateLimit(limiters)); // before body parsing: floods are rejected cheaply
  app.use(json({ limit: `${env.BODY_LIMIT_KB}kb`, strict: true, type: 'application/json' }));
  app.use(middlewareErrors());

  const routes = listRoutes(app.get(DiscoveryService).getControllers());
  SwaggerModule.setup('docs', app, buildOpenApi(routes, cookieName(env.COOKIE_SECURE)));

  await app.init();

  // Slow-client (slowloris) protection.
  const server = app.getHttpServer();
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;

  return { app, limiters };
};
