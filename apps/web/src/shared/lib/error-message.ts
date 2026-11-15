'use client';

import { useTranslations } from 'next-intl';
import { isApiError } from '@/shared/api/client';

/** Turns any thrown value into a message in the user's language. */
export const useErrorMessage = (): ((error: unknown) => string) => {
  const t = useTranslations('errors');
  const common = useTranslations('common');
  return (error) => {
    if (!isApiError(error)) return common('somethingWrong');
    return t.has(error.code) ? t(error.code) : common('somethingWrong');
  };
};
