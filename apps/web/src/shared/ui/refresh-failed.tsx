'use client';

import { useTranslations } from 'next-intl';
import { Alert } from './alert';

/**
 * Shown above a screen that keeps working with its last known data after a refresh failed. The screen is NOT
 * replaced: open dialogs and half-typed text stay where they are.
 */
export const RefreshFailed = () => {
  const t = useTranslations('common');
  return <Alert tone="warning">{t('refreshFailed')}</Alert>;
};
