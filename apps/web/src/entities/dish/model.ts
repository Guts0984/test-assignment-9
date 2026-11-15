'use client';

import { useQuery } from '@tanstack/react-query';
import type { Dish, ModifierGroup } from '@app/shared';
import { keys } from '@/shared/api/query-keys';
import { fetchMenu } from './api';

export const useMenu = (live: boolean) =>
  useQuery({
    queryKey: keys.menu,
    queryFn: () => fetchMenu(false),
    refetchInterval: live ? false : 15_000,
  });

/** Dishes grouped by category, categories and dishes in a stable order. */
export const groupByCategory = (
  dishes: readonly Dish[],
): { category: string; dishes: Dish[] }[] => {
  const map = new Map<string, Dish[]>();
  for (const d of dishes) map.set(d.category, [...(map.get(d.category) ?? []), d]);
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({
      category,
      dishes: list.sort((a, b) => a.name.localeCompare(b.name)),
    }));
};

export type GroupProblem = {
  groupId: string;
  kind: 'min' | 'max';
  min: number;
  max: number;
  groupName: string;
};

/**
 * Client-side mirror of the server rule: each group needs between `min` and `max` selections.
 * Returns the violated groups (empty array = valid). The server still validates everything.
 */
export const checkModifierSelection = (
  groups: readonly ModifierGroup[],
  selected: ReadonlySet<string>,
): GroupProblem[] =>
  groups.flatMap((g): GroupProblem[] => {
    const n = g.modifiers.filter((m) => selected.has(m.id)).length;
    if (n < g.min)
      return [{ groupId: g.id, kind: 'min' as const, min: g.min, max: g.max, groupName: g.name }];
    if (n > g.max)
      return [{ groupId: g.id, kind: 'max' as const, min: g.min, max: g.max, groupName: g.name }];
    return [];
  });

/** Sum of the surcharges of the selected modifiers (kopecks). */
export const surchargeOf = (
  groups: readonly ModifierGroup[],
  selected: ReadonlySet<string>,
): number =>
  groups.reduce(
    (sum, g) =>
      sum + g.modifiers.filter((m) => selected.has(m.id)).reduce((s, m) => s + m.surcharge, 0),
    0,
  );

/**
 * Toggles a modifier. Single-choice groups (max = 1) behave like radio buttons: picking one replaces
 * the previous choice. Multi-choice groups toggle freely (the min/max problems are shown, not blocked).
 */
export const toggleModifier = (
  groups: readonly ModifierGroup[],
  selected: ReadonlySet<string>,
  modifierId: string,
): Set<string> => {
  const next = new Set(selected);
  const group = groups.find((g) => g.modifiers.some((m) => m.id === modifierId));
  if (!group) return next;
  if (next.has(modifierId)) {
    next.delete(modifierId);
    return next;
  }
  if (group.max === 1) for (const m of group.modifiers) next.delete(m.id);
  next.add(modifierId);
  return next;
};
