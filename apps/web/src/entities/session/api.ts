import { z } from 'zod';
import { type LoginBody, Me } from '@app/shared';
import { isApiError, request } from '@/shared/api/client';

export const fetchMe = async (): Promise<Me | null> => {
  try {
    return await request('/me', Me);
  } catch (e) {
    if (isApiError(e) && e.status === 401) return null;
    throw e;
  }
};
export const login = (body: LoginBody): Promise<Me> =>
  request('/auth/login', Me, { method: 'POST', json: body });
export const logout = (): Promise<undefined> =>
  request('/auth/logout', z.undefined(), { method: 'POST', json: {} });
