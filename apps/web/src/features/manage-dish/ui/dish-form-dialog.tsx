'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import {
  type Control,
  type FieldPath,
  type UseFormRegister,
  useFieldArray,
  useForm,
} from 'react-hook-form';
import type { Dish } from '@app/shared';
import { useDishMutations } from '@/entities/dish/mutations';
import { isApiError } from '@/shared/api/client';
import type { Locale } from '@/shared/i18n/routing';
import { useErrorMessage } from '@/shared/lib/error-message';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { Input, Select } from '@/shared/ui/input';
import {
  type DishFormValues,
  dishFormSchema,
  dishToForm,
  emptyDishForm,
  formToPayload,
} from '../lib/dish-form-schema';

type GroupErrors = NonNullable<
  ReturnType<typeof useForm<DishFormValues>>['formState']['errors']['modifierGroups']
>;

const ModifierRows = ({
  control,
  register,
  index,
  errors,
}: {
  control: Control<DishFormValues>;
  register: UseFormRegister<DishFormValues>;
  index: number;
  errors: GroupErrors;
}) => {
  const t = useTranslations('menu');
  const rows = useFieldArray({ control, name: `modifierGroups.${index}.modifiers` });
  const groupErrors = errors[index];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{t('modifiers')}</span>
      {rows.fields.map((f, mi) => (
        <div key={f.id} className="grid grid-cols-[1fr_8rem_auto] items-start gap-2">
          <Field label={t('modifierName')} error={groupErrors?.modifiers?.[mi]?.name?.message}>
            {(p) => <Input {...p} {...register(`modifierGroups.${index}.modifiers.${mi}.name`)} />}
          </Field>
          <Field label={t('surcharge')} error={groupErrors?.modifiers?.[mi]?.surcharge?.message}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                {...register(`modifierGroups.${index}.modifiers.${mi}.surcharge`)}
              />
            )}
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-6"
            aria-label={t('removeModifier')}
            onClick={() => rows.remove(mi)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ))}
      {groupErrors?.modifiers?.root?.message || groupErrors?.modifiers?.message ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {groupErrors?.modifiers?.root?.message ?? groupErrors?.modifiers?.message}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => rows.append({ name: '', surcharge: '0' })}
      >
        <Plus className="h-4 w-4" aria-hidden /> {t('addModifier')}
      </Button>
    </div>
  );
};

/** Create a dish, or edit one (name, price, stock, modifier groups with their min/max rules). */
const DishFormBody = ({ dish, onClose }: { dish: Dish | null; onClose: () => void }) => {
  const t = useTranslations('menu');
  const common = useTranslations('common');
  const locale = useLocale() as Locale;
  const message = useErrorMessage();
  const { create, patch } = useDishMutations();

  const schema = dishFormSchema({
    nameRequired: t('nameRequired'),
    categoryRequired: t('categoryRequired'),
    priceInvalid: t('priceInvalid'),
    stockInvalid: t('stockInvalid'),
    minMax: t('minMax'),
    maxOptions: t('maxOptions'),
    maxOne: t('maxOne'),
    needOption: t('needOption'),
  });
  const form = useForm<DishFormValues>({
    resolver: zodResolver(schema),
    // Only the starting point. The dish keeps changing while this is open (every sale moves its stock); that
    // must never wipe what the manager has typed.
    defaultValues: dish ? dishToForm(dish, locale) : emptyDishForm(),
    mode: 'onTouched',
  });
  const groups = useFieldArray({ control: form.control, name: 'modifierGroups' });
  const errors = form.formState.errors;
  // read during render so that the form keeps track of it (formState is subscription based)
  const stockTouched = Boolean(form.formState.dirtyFields.stock);
  const mutation = dish ? patch : create;

  /** The API's 400/422 details name the field (same path as the form's); mark those fields, in our language. */
  const showServerProblems = (e: unknown) => {
    if (!isApiError(e)) return;
    for (const d of e.details) {
      form.setError(d.path as FieldPath<DishFormValues>, { message: t('fieldRejected') });
    }
  };

  const submit = form.handleSubmit((values) => {
    const payload = formToPayload(values);
    const done = { onSuccess: onClose, onError: showServerProblems };
    if (dish) {
      // The stock changes by itself while this dialog is open (every sale). Send it only when the manager
      // actually typed a new number; a rename must never put sold portions back on the shelf.
      const { stock: _stock, ...withoutStock } = payload;
      const body = stockTouched ? payload : withoutStock;
      patch.mutate({ id: dish.id, body }, done);
    } else create.mutate(payload, done);
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{dish ? t('editTitle', { name: dish.name }) : t('createTitle')}</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {mutation.error ? <Alert tone="error">{message(mutation.error)}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('name')} error={errors.name?.message}>
            {(p) => <Input {...p} autoFocus {...form.register('name')} />}
          </Field>
          <Field label={t('category')} error={errors.category?.message}>
            {(p) => <Input {...p} {...form.register('category')} />}
          </Field>
          <Field label={t('price')} error={errors.price?.message}>
            {(p) => <Input {...p} inputMode="decimal" {...form.register('price')} />}
          </Field>
          <Field label={t('station')}>
            {(p) => (
              <Select {...p} {...form.register('station')}>
                <option value="kitchen">{t('stationKitchen')}</option>
                <option value="bar">{t('stationBar')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('stock')} hint={t('stockHint')} error={errors.stock?.message}>
            {(p) => <Input {...p} inputMode="numeric" {...form.register('stock')} />}
          </Field>
        </div>

        <section className="flex flex-col gap-3" aria-labelledby="groups-title">
          <h3 id="groups-title" className="text-sm font-semibold">
            {t('groups')}
          </h3>
          {groups.fields.map((g, gi) => (
            <div key={g.id} className="flex flex-col gap-3 rounded-md border p-3">
              <div className="grid grid-cols-[1fr_5rem_5rem_auto] items-start gap-2">
                <Field label={t('groupName')} error={errors.modifierGroups?.[gi]?.name?.message}>
                  {(p) => <Input {...p} {...form.register(`modifierGroups.${gi}.name`)} />}
                </Field>
                <Field label={t('min')} error={errors.modifierGroups?.[gi]?.min?.message}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={0}
                      {...form.register(`modifierGroups.${gi}.min`)}
                    />
                  )}
                </Field>
                <Field label={t('max')} error={errors.modifierGroups?.[gi]?.max?.message}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={1}
                      {...form.register(`modifierGroups.${gi}.max`)}
                    />
                  )}
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-6"
                  aria-label={t('removeGroup')}
                  onClick={() => groups.remove(gi)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <ModifierRows
                control={form.control}
                register={form.register}
                index={gi}
                errors={errors.modifierGroups ?? ([] as unknown as GroupErrors)}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              groups.append({
                name: '',
                min: 0,
                max: 1,
                modifiers: [{ name: '', surcharge: '0' }],
              })
            }
          >
            <Plus className="h-4 w-4" aria-hidden /> {t('addGroup')}
          </Button>
        </section>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {common('save')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};

/**
 * The form is built only while the dialog is open, so every opening starts from a clean form: "Add a dish"
 * never shows what was typed (or saved) the last time, and editing starts from the dish as it is now.
 */
export const DishFormDialog = ({
  dish,
  open,
  onClose,
}: {
  dish: Dish | null;
  open: boolean;
  onClose: () => void;
}) => {
  const common = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent closeLabel={common('close')} className="max-w-2xl">
        {open ? <DishFormBody dish={dish} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
};
