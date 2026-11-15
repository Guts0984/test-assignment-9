import { TablesResponse } from '@app/shared';
import { request } from '@/shared/api/client';

export const fetchTables = async () => (await request('/tables', TablesResponse)).tables;
