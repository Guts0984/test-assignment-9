import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ENDPOINT_KEY, type EndpointMeta } from '../common/endpoint';

export type RouteInfo = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Express-style path, e.g. `/orders/:id/items`. */
  path: string;
  handler: string;
  meta: EndpointMeta | undefined;
};

type ControllerLike = { metatype: unknown };

const join = (...parts: string[]): string =>
  '/' +
  parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

/** Reads every route straight from the controllers' decorators — the same data the router uses. */
export const listRoutes = (controllers: readonly ControllerLike[]): RouteInfo[] => {
  const routes: RouteInfo[] = [];
  for (const c of controllers) {
    const metatype = c.metatype;
    if (typeof metatype !== 'function') continue;
    const ctor = metatype as { name: string; prototype: Record<string, unknown> };
    const prefix: string = Reflect.getMetadata(PATH_METADATA, ctor) ?? '';
    for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
      const fn = ctor.prototype[name];
      if (typeof fn !== 'function') continue;
      const methodCode: number | undefined = Reflect.getMetadata(METHOD_METADATA, fn);
      if (methodCode === undefined) continue;
      const path: string = Reflect.getMetadata(PATH_METADATA, fn) ?? '';
      routes.push({
        method: RequestMethod[methodCode] as RouteInfo['method'],
        path: join(prefix, path),
        handler: `${ctor.name}.${name}`,
        meta: Reflect.getMetadata(ENDPOINT_KEY, fn) as EndpointMeta | undefined,
      });
    }
  }
  return routes;
};
