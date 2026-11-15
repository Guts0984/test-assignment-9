'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/shared/api/client';
import { keys } from '@/shared/api/query-keys';
import { advanceItem } from './api';

export const useAdvanceItem = (onConflict?: () => void) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'cooking' | 'ready' }) =>
      advanceItem(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.kitchen }),
    onError: (e) => {
      // Someone cancelled it, or another cook moved it: refresh and tell the cook.
      if (isApiError(e) && (e.status === 409 || e.status === 404)) {
        void qc.invalidateQueries({ queryKey: keys.kitchen });
        onConflict?.();
      }
    },
  });
};
