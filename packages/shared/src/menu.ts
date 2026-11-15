import { z } from 'zod';
import { LIMITS, id, kopecks, text } from './primitives';
import { Station } from './enums';

export const ModifierInput = z.object({ name: text(), surcharge: kopecks }).strict();

/** Pick between `min` and `max` modifiers of a group. "Exactly 1" is min=1,max=1; "0–3" is min=0,max=3. */
export const ModifierGroupInput = z
  .object({
    name: text(),
    min: z.number().int().min(0),
    max: z.number().int().min(1),
    modifiers: z.array(ModifierInput).min(1).max(LIMITS.maxModifiersPerGroup),
  })
  .strict()
  .superRefine((g, ctx) => {
    if (g.min > g.max) {
      ctx.addIssue({ code: 'custom', path: ['min'], message: 'min must be <= max' });
    }
    if (g.max > g.modifiers.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['max'],
        message: 'max cannot exceed the number of modifiers',
      });
    }
  });

/** `stock: null` means unlimited. */
const dishFields = {
  name: text(),
  category: text(),
  price: kopecks,
  station: Station,
  stock: z.number().int().min(0).max(LIMITS.maxStock).nullable(),
  modifierGroups: z.array(ModifierGroupInput).max(LIMITS.maxModifierGroups),
};

export const DishCreate = z.object(dishFields).strict();
export type DishCreate = z.infer<typeof DishCreate>;

export const DishPatch = z
  .object(dishFields)
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'At least one field is required' });
export type DishPatch = z.infer<typeof DishPatch>;

export const Modifier = z.object({ id, name: z.string(), surcharge: kopecks });
export type Modifier = z.infer<typeof Modifier>;

export const ModifierGroup = z.object({
  id,
  name: z.string(),
  min: z.number().int(),
  max: z.number().int(),
  modifiers: z.array(Modifier),
});
export type ModifierGroup = z.infer<typeof ModifierGroup>;

export const Dish = z.object({
  id,
  name: z.string(),
  category: z.string(),
  price: kopecks,
  station: Station,
  stock: z.number().int().nullable(),
  /** Derived: stock === 0. Stop-listed dishes cannot be added. */
  stopListed: z.boolean(),
  archived: z.boolean(),
  modifierGroups: z.array(ModifierGroup),
});
export type Dish = z.infer<typeof Dish>;

export const MenuResponse = z.object({ dishes: z.array(Dish) });
export type MenuResponse = z.infer<typeof MenuResponse>;
