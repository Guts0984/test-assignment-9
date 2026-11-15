'use client';

import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import type { ModifierGroup } from '@app/shared';
import { checkModifierSelection } from '@/entities/dish/model';
import type { Locale } from '@/shared/i18n/routing';
import { formatMoney } from '@/shared/lib/money';
import { cn } from '@/shared/lib/cn';

/**
 * Modifier groups of a dish. "Exactly one" groups are radio buttons (arrow keys move the choice);
 * everything else is checkboxes. Rule violations are shown under the group they belong to.
 */
export const ModifierPicker = ({
  groups,
  selected,
  onToggle,
  showErrors,
}: {
  groups: readonly ModifierGroup[];
  selected: ReadonlySet<string>;
  onToggle: (modifierId: string) => void;
  showErrors: boolean;
}) => {
  const t = useTranslations('picker');
  const locale = useLocale() as Locale;
  const problems = new Map(checkModifierSelection(groups, selected).map((p) => [p.groupId, p]));

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        const problem = problems.get(g.id);
        const radio = g.min === 1 && g.max === 1;
        const rule =
          g.min === g.max
            ? t('groupExactly', { count: g.min })
            : g.min === 0
              ? t('groupUpTo', { max: g.max })
              : t('groupRange', { min: g.min, max: g.max });
        const errorId = `group-${g.id}-error`;
        return (
          <fieldset
            key={g.id}
            className="flex flex-col gap-2"
            aria-describedby={showErrors && problem ? errorId : undefined}
          >
            <legend className="text-sm font-semibold">
              {g.name} <span className="font-normal text-muted-foreground">· {rule}</span>
            </legend>
            <div className="flex flex-col gap-1">
              {g.modifiers.map((m) => (
                <label
                  key={m.id}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm',
                    selected.has(m.id) ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type={radio ? 'radio' : 'checkbox'}
                      name={`group-${g.id}`}
                      checked={selected.has(m.id)}
                      onChange={() => onToggle(m.id)}
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    {m.name}
                  </span>
                  <span className="text-muted-foreground">
                    {m.surcharge > 0 ? `+${formatMoney(m.surcharge, locale)}` : t('free')}
                  </span>
                </label>
              ))}
            </div>
            {showErrors && problem ? (
              <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
                {problem.kind === 'min'
                  ? t('groupMin', { group: g.name, min: g.min })
                  : t('groupMax', { group: g.name, max: g.max })}
              </p>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
};
