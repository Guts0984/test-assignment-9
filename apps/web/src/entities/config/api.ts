import { AppConfig } from '@app/shared';
import { request } from '@/shared/api/client';

export const fetchConfig = () => request('/config', AppConfig);
