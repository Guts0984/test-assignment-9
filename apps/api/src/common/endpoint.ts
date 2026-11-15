import { SetMetadata } from '@nestjs/common';
import type { Role } from '@app/shared';
import type { ZodTypeAny } from 'zod';

export const ENDPOINT_KEY = 'endpoint';

export type Access =
  /** No session needed. */
  | 'public'
  /** Any logged-in user. */
  | 'any'
  /** Logged-in user with one of these roles. */
  | readonly Role[];

export type EndpointMeta = {
  access: Access;
  summary: string;
  tag: string;
  /** Validated against the JSON body (must be application/json). */
  body?: ZodTypeAny;
  /** Validated against the query string. */
  query?: ZodTypeAny;
  /** Documented success body. */
  response?: ZodTypeAny;
  /** Documented success status (default 200). */
  status?: number;
};

/**
 * Single source of truth for a route: who may call it, how input is validated, what it documents.
 * Routes WITHOUT this decorator are denied (see AccessGuard) — forgetting it can never open a route.
 */
export const Endpoint = (meta: EndpointMeta) => SetMetadata(ENDPOINT_KEY, meta);
