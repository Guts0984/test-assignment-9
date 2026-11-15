import type { Request, Response } from 'express';
import type { Role } from '@app/shared';

export type AuthUser = { id: string; username: string; displayName: string; role: Role };

export type AppRequest = Request & {
  id: string;
  user?: AuthUser;
  sessionId?: string;
};
export type AppResponse = Response;
