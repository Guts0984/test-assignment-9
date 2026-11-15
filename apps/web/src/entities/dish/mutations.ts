'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DishCreate, DishPatch } from '@app/shared';
import { keys } from '@/shared/api/query-keys';
import { archiveDish, createDish, patchDish } from './api';

export const useDishMutations = () => {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: keys.menu });
  return {
    create: useMutation({ mutationFn: (b: DishCreate) => createDish(b), onSuccess: done }),
    patch: useMutation({
      mutationFn: ({ id, body }: { id: string; body: DishPatch }) => patchDish(id, body),
      onSuccess: done,
    }),
    archive: useMutation({ mutationFn: (id: string) => archiveDish(id), onSuccess: done }),
  };
};
