import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DB, ENV } from './tokens';
import type { DbHandle } from '@app/db';
import type { Env } from '../env';
import { ENDPOINT_KEY, type EndpointMeta } from './endpoint';
import { forbidden, unauthenticated } from './errors';
import { isOriginAllowed } from './origin';
import type { AppRequest } from './request';
import { findSession, readSessionToken } from '../auth/session';

/**
 * The only door: runs for every route.
 *   1. no @Endpoint metadata  → denied (a forgotten decorator can never expose a route);
 *   2. unsafe method from a foreign origin → denied (CSRF);
 *   3. non-public → a valid server-side session is required;
 *   4. role not in the route's list → denied.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<EndpointMeta | undefined>(ENDPOINT_KEY, context.getHandler());
    if (!meta) throw forbidden('Route is not exposed');
    const req = context.switchToHttp().getRequest<AppRequest>();

    const allowed = isOriginAllowed({
      method: req.method,
      origin: req.headers.origin,
      secFetchSite: header(req.headers['sec-fetch-site']),
      host: req.headers.host,
      allowedOrigins: this.env.WEB_ORIGINS,
    });
    if (!allowed) throw forbidden('Cross-origin request rejected');

    if (meta.access === 'public') return true;

    const token = readSessionToken(req.headers.cookie, this.env.COOKIE_SECURE);
    const found = token ? await findSession(this.handle.db, token) : undefined;
    if (!found) throw unauthenticated();
    req.user = found.user;
    req.sessionId = found.sessionId;

    if (meta.access !== 'any' && !meta.access.includes(found.user.role)) throw forbidden();
    return true;
  }
}

const header = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;
