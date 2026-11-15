import { RevenueResponse } from '@app/shared';
import { request } from '@/shared/api/client';

export const fetchRevenue = (from: string, to: string) =>
  request(`/reports/revenue?from=${from}&to=${to}`, RevenueResponse);
