import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { z, type ZodTypeAny } from 'zod';
import { zodDetails } from './all-exceptions.filter';
import { ENDPOINT_KEY, type EndpointMeta } from './endpoint';
import { AppError, badRequest } from './errors';
import type { AppRequest } from './request';

const uuid = z.string().uuid();

const parseWith = (schema: ZodTypeAny, data: unknown, what: string): unknown => {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest(`Invalid ${what}`, zodDetails(r.error));
  return r.data;
};

/**
 * Validates input with the Zod schemas declared on the route (packages/shared), AFTER the access
 * guard (so anonymous callers learn nothing about validation) and BEFORE the handler. Handlers only
 * ever see parsed, strictly typed data.
 */
@Injectable()
export class ValidationInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<EndpointMeta | undefined>(ENDPOINT_KEY, context.getHandler());
    const req = context.switchToHttp().getRequest<AppRequest>();

    // Every `:id`-style path parameter is a UUID: malformed ids are a 400, never a database error.
    for (const [name, value] of Object.entries(req.params as Record<string, unknown>)) {
      if (!/id$/i.test(name)) continue;
      if (!uuid.safeParse(value).success) {
        throw badRequest(`Invalid ${name}`, [{ path: name, message: 'Must be a UUID' }]);
      }
    }

    if (meta?.body) {
      if (!req.is('application/json')) {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
      }
      req.body = parseWith(meta.body, req.body, 'body');
    }
    if (meta?.query) {
      const parsed = parseWith(meta.query, req.query, 'query');
      // Express 5 exposes `query` as a getter; shadow it on this request instance.
      Object.defineProperty(req, 'query', { value: parsed, configurable: true, enumerable: true });
    }
    return next.handle();
  }
}
