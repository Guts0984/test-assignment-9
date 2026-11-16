import { z } from 'zod';
import { type Dish, type DishCreate, LIMITS } from '@app/shared';
import { moneyToInput, parseMoneyInput } from '@/shared/lib/money';
import type { Locale } from '@/shared/i18n/routing';

/** Messages come from the translation catalogue; keys are looked up by the caller. */
export type DishFormMessages = {
  nameRequired: string;
  categoryRequired: string;
  priceInvalid: string;
  stockInvalid: string;
  minMax: string;
  maxOptions: string;
  maxOne: string;
  needOption: string;
};

const money = (message: string) =>
  z.string().refine((s) => {
    const k = parseMoneyInput(s);
    return k !== null && k <= LIMITS.maxPrice;
  }, message);

/** Form (strings and numbers as typed) → the exact payload the API accepts (DishCreate). */
export const dishFormSchema = (m: DishFormMessages) => {
  const modifier = z.object({
    /** The id of an existing modifier (kept on save, so past and open orders still point at it). */
    dbId: z.string().optional(),
    name: z.string().trim().min(1, m.nameRequired).max(LIMITS.maxNameLength),
    surcharge: money(m.priceInvalid),
  });
  const group = z
    .object({
      dbId: z.string().optional(),
      name: z.string().trim().min(1, m.nameRequired).max(LIMITS.maxNameLength),
      min: z.coerce.number().int().min(0),
      max: z.coerce.number().int().min(1, m.maxOne),
      modifiers: z.array(modifier).min(1, m.needOption).max(LIMITS.maxModifiersPerGroup),
    })
    .superRefine((g, ctx) => {
      if (g.min > g.max) ctx.addIssue({ code: 'custom', path: ['min'], message: m.minMax });
      if (g.max > g.modifiers.length)
        ctx.addIssue({ code: 'custom', path: ['max'], message: m.maxOptions });
    });
  return z.object({
    name: z.string().trim().min(1, m.nameRequired).max(LIMITS.maxNameLength),
    category: z.string().trim().min(1, m.categoryRequired).max(LIMITS.maxNameLength),
    price: money(m.priceInvalid),
    station: z.enum(['kitchen', 'bar']),
    stock: z
      .string()
      .refine(
        (s) =>
          s.trim() === '' || (/^\d{1,6}$/.test(s.trim()) && Number(s.trim()) <= LIMITS.maxStock),
        m.stockInvalid,
      ),
    modifierGroups: z.array(group).max(LIMITS.maxModifierGroups),
  });
};

export type DishFormValues = z.input<ReturnType<typeof dishFormSchema>>;

export const emptyDishForm = (): DishFormValues => ({
  name: '',
  category: '',
  price: '',
  station: 'kitchen',
  stock: '',
  modifierGroups: [],
});

export const dishToForm = (dish: Dish, locale: Locale): DishFormValues => ({
  name: dish.name,
  category: dish.category,
  price: moneyToInput(dish.price, locale),
  station: dish.station,
  stock: dish.stock === null ? '' : String(dish.stock),
  modifierGroups: dish.modifierGroups.map((g) => ({
    dbId: g.id,
    name: g.name,
    min: g.min,
    max: g.max,
    modifiers: g.modifiers.map((x) => ({
      dbId: x.id,
      name: x.name,
      surcharge: moneyToInput(x.surcharge, locale),
    })),
  })),
});

/** Validated form values → API payload. Throws if the conversion cannot be made (cannot happen after validation). */
export const formToPayload = (v: DishFormValues): DishCreate => {
  const price = parseMoneyInput(v.price);
  if (price === null) throw new Error('invalid price');
  return {
    name: v.name.trim(),
    category: v.category.trim(),
    price,
    station: v.station,
    stock: v.stock.trim() === '' ? null : Number(v.stock.trim()),
    modifierGroups: v.modifierGroups.map((g) => ({
      ...(g.dbId ? { id: g.dbId } : {}),
      name: g.name.trim(),
      min: Number(g.min),
      max: Number(g.max),
      modifiers: g.modifiers.map((x) => ({
        ...(x.dbId ? { id: x.dbId } : {}),
        name: x.name.trim(),
        surcharge: parseMoneyInput(x.surcharge) ?? 0,
      })),
    })),
  };
};
