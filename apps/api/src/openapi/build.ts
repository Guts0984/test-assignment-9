import type { OpenAPIObject } from '@nestjs/swagger';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import { ApiErrorBody } from '@app/shared';
import { type RouteInfo } from './routes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAPI schema objects are open-ended JSON
type Json = Record<string, any>;

const schemaOf = (s: ZodTypeAny): Json =>
  zodToJsonSchema(s, { target: 'openApi3', $refStrategy: 'none' }) as Json;

const toOpenApiPath = (p: string): string => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const queryParams = (schema: ZodTypeAny): Json[] => {
  const json = schemaOf(schema);
  const required = new Set<string>(json.required ?? []);
  return Object.entries((json.properties ?? {}) as Record<string, Json>).map(([name, s]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: s,
  }));
};

const roleText = (access: NonNullable<RouteInfo['meta']>['access']): string =>
  access === 'public'
    ? 'Public.'
    : access === 'any'
      ? 'Any logged-in user.'
      : `Roles: ${access.join(', ')}.`;

/** OpenAPI 3 document generated from the same Zod schemas that validate requests. */
export const buildOpenApi = (routes: readonly RouteInfo[], cookie: string): OpenAPIObject => {
  const paths: Record<string, Json> = {};
  const errorSchema = schemaOf(ApiErrorBody);

  for (const r of routes) {
    if (!r.meta) continue;
    const m = r.meta;
    const path = toOpenApiPath(r.path);
    const pathParams = [...r.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((x) => ({
      name: x[1],
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    }));
    const status = String(m.status ?? 200);
    const errorResponse = (description: string): Json => ({
      description,
      content: { 'application/json': { schema: errorSchema } },
    });
    const op: Json = {
      tags: [m.tag],
      summary: m.summary,
      description: roleText(m.access),
      operationId: r.handler.replace('.', '_'),
      parameters: [...pathParams, ...(m.query ? queryParams(m.query) : [])],
      ...(m.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: schemaOf(m.body) } },
            },
          }
        : {}),
      responses: {
        [status]: {
          description: 'Success',
          ...(m.response
            ? { content: { 'application/json': { schema: schemaOf(m.response) } } }
            : {}),
        },
        '400': errorResponse('Validation failed'),
        ...(m.access !== 'public'
          ? { '401': errorResponse('Not logged in'), '403': errorResponse('Forbidden') }
          : {}),
        '429': errorResponse('Rate limited'),
      },
      ...(m.access === 'public' ? {} : { security: [{ cookieAuth: [] }] }),
    };
    (paths[path] ??= {})[r.method.toLowerCase()] = op;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Restaurant orders API',
      version: '1.0.0',
      description:
        'Money is always an integer number of kopecks. Errors use one envelope: { error: { code, message, requestId, details? } }.',
    },
    tags: [],
    paths,
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: cookie } },
    },
  } as unknown as OpenAPIObject;
};
