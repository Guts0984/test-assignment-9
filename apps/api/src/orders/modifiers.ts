import type { ModifierGroup } from '@app/shared';
import { type ErrorDetail, unprocessable } from '../common/errors';

export type ChosenModifier = { id: string; name: string; surcharge: number };

/**
 * Checks a modifier selection against the dish's groups ("pick min…max") and returns the chosen
 * modifiers. Pure function: throws a 422 listing every violated rule.
 */
export const validateModifiers = (
  groups: readonly ModifierGroup[],
  chosenIds: readonly string[],
): ChosenModifier[] => {
  const problems: ErrorDetail[] = [];
  const byId = new Map(groups.flatMap((g) => g.modifiers.map((m) => [m.id, { g, m }] as const)));

  if (new Set(chosenIds).size !== chosenIds.length) {
    problems.push({ path: 'modifierIds', message: 'The same modifier was selected twice' });
  }
  const unknown = chosenIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    problems.push({ path: 'modifierIds', message: 'Some modifiers do not belong to this dish' });
  }
  for (const g of groups) {
    const n = new Set(chosenIds.filter((id) => byId.get(id)?.g.id === g.id)).size;
    if (n < g.min || n > g.max) {
      const rule = g.min === g.max ? `exactly ${g.min}` : `from ${g.min} to ${g.max}`;
      problems.push({ path: 'modifierIds', message: `"${g.name}": choose ${rule} (got ${n})` });
    }
  }
  if (problems.length > 0) throw unprocessable('Invalid modifier selection', problems);

  return [...new Set(chosenIds)].map((id) => {
    const found = byId.get(id)!;
    return { id, name: found.m.name, surcharge: found.m.surcharge };
  });
};
