import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dish } from '@app/shared';
import { DishCreate } from '@app/shared';
import { DishFormDialog, dishFormSchema, dishToForm, formToPayload } from './index';
import { id, mockFetch, renderApp, steak } from '../../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const messages = {
  nameRequired: 'name',
  categoryRequired: 'category',
  priceInvalid: 'price',
  stockInvalid: 'stock',
  minMax: 'minmax',
  maxOptions: 'maxopts',
  maxOne: 'maxone',
  needOption: 'needopt',
};

describe('dish form schema and payload', () => {
  const valid = {
    name: 'Pasta',
    category: 'Mains',
    price: '210,50',
    station: 'kitchen' as const,
    stock: '',
    modifierGroups: [
      {
        name: 'Size',
        min: 1,
        max: 1,
        modifiers: [
          { name: 'S', surcharge: '0' },
          { name: 'L', surcharge: '50' },
        ],
      },
    ],
  };
  it('a valid form converts to exactly the payload the API accepts', () => {
    const parsed = dishFormSchema(messages).safeParse(valid);
    expect(parsed.success).toBe(true);
    const payload = formToPayload(valid);
    expect(payload).toEqual({
      name: 'Pasta',
      category: 'Mains',
      price: 21050,
      station: 'kitchen',
      stock: null,
      modifierGroups: [
        {
          name: 'Size',
          min: 1,
          max: 1,
          modifiers: [
            { name: 'S', surcharge: 0 },
            { name: 'L', surcharge: 5000 },
          ],
        },
      ],
    });
    expect(DishCreate.safeParse(payload).success).toBe(true); // same Zod schema the server uses
  });
  it('the min/max rules produce errors at the right fields', () => {
    const group = (min: number, max: number) => ({
      ...valid,
      modifierGroups: [
        {
          name: 'g',
          min,
          max,
          modifiers: [
            { name: 'a', surcharge: '0' },
            { name: 'b', surcharge: '0' },
          ],
        },
      ],
    });
    const issues = (v: typeof valid) => {
      const r = dishFormSchema(messages).safeParse(v);
      return r.success ? [] : r.error.issues.map((i) => [i.path.join('.'), i.message]);
    };
    expect(issues(group(2, 1))).toContainEqual(['modifierGroups.0.min', 'minmax']); // min > max
    expect(issues(group(0, 5))).toContainEqual(['modifierGroups.0.max', 'maxopts']); // max > options
    expect(issues(group(0, 0))).toContainEqual(['modifierGroups.0.max', 'maxone']); // max < 1
    expect(issues(group(1, 1))).toEqual([]); // exactly one
    expect(issues(group(0, 2))).toEqual([]); // 0 to all options
    const empty = { ...valid, modifierGroups: [{ name: 'g', min: 0, max: 1, modifiers: [] }] };
    expect(issues(empty as unknown as typeof valid).map((x) => x[1])).toContain('needopt');
  });
  it.each([
    [{ name: '  ' }, 'name'],
    [{ category: '' }, 'category'],
    [{ price: 'abc' }, 'price'],
    [{ price: '100000,01' }, 'price'],
    [{ price: '-5' }, 'price'],
    [{ stock: '-1' }, 'stock'],
    [{ stock: '1.5' }, 'stock'],
    [{ stock: 'abc' }, 'stock'],
  ])('rejects %j', (over, message) => {
    const r = dishFormSchema(messages).safeParse({ ...valid, ...over });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.message)).toContain(message);
  });
  it('stock: empty = unlimited (null), 0 = stop-list, digits = portions', () => {
    expect(formToPayload({ ...valid, stock: '' }).stock).toBeNull();
    expect(formToPayload({ ...valid, stock: '0' }).stock).toBe(0);
    expect(formToPayload({ ...valid, stock: '5' }).stock).toBe(5);
  });
  it('an existing dish round-trips through the form (editing without changes keeps the data)', () => {
    const d = steak() as unknown as Dish;
    expect(formToPayload(dishToForm(d, 'en'))).toEqual({
      name: d.name,
      category: d.category,
      price: d.price,
      station: d.station,
      stock: d.stock,
      modifierGroups: d.modifierGroups.map((g) => ({
        name: g.name,
        min: g.min,
        max: g.max,
        modifiers: g.modifiers.map((m) => ({ name: m.name, surcharge: m.surcharge })),
      })),
    });
  });
});

describe('DishFormDialog', () => {
  it('shows errors at the fields, sends nothing until the form is valid, then creates the dish', async () => {
    const { calls } = mockFetch(() => ({ ...steak(), id: id(900) }));
    const onClose = vi.fn();
    renderApp(<DishFormDialog dish={null} open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a name')).toBeInTheDocument();
    expect(screen.getByText('Enter a category')).toBeInTheDocument();
    expect(screen.getByText(/Enter a price like 125.50/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await userEvent.type(screen.getByLabelText('Name'), 'Pasta');
    await userEvent.type(screen.getByLabelText('Category'), 'Mains');
    await userEvent.type(screen.getByLabelText('Price'), '210.50');
    await userEvent.type(screen.getByLabelText('Portions left'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Add a group' }));
    await userEvent.type(screen.getByLabelText('Group name'), 'Size');
    const min = screen.getByLabelText('Min');
    const max = screen.getByLabelText('Max');
    await userEvent.clear(min);
    await userEvent.type(min, '2');
    await userEvent.clear(max);
    await userEvent.type(max, '1');
    await userEvent.type(screen.getByLabelText('Option name'), 'Small');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Min cannot be greater than max')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await userEvent.clear(min);
    await userEvent.type(min, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({
      url: '/api/dishes',
      method: 'POST',
      body: {
        name: 'Pasta',
        category: 'Mains',
        price: 21050,
        station: 'kitchen',
        stock: 5,
        modifierGroups: [
          { name: 'Size', min: 1, max: 1, modifiers: [{ name: 'Small', surcharge: 0 }] },
        ],
      },
    });
  });
  it('editing sends a PATCH with the changed data', async () => {
    const dish = steak() as unknown as Dish;
    const { calls } = mockFetch(() => dish);
    const onClose = vi.fn();
    renderApp(<DishFormDialog dish={dish} open onClose={onClose} />);
    const price = screen.getByLabelText('Price');
    await userEvent.clear(price);
    await userEvent.type(price, '300');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({
      url: `/api/dishes/${dish.id}`,
      method: 'PATCH',
      body: { price: 30000, name: 'Steak' },
    });
    expect(within(screen.getByRole('dialog')).getByText('Edit “Steak”')).toBeInTheDocument();
  });
  it('a rename does NOT send the stock it saw when the dialog opened (sold portions stay sold)', async () => {
    const dish = { ...steak(), stock: 2 } as unknown as Dish;
    const { calls } = mockFetch(() => dish);
    const onClose = vi.fn();
    renderApp(<DishFormDialog dish={dish} open onClose={onClose} />);
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Big steak');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.name).toBe('Big steak');
    expect(body).not.toHaveProperty('stock');
  });
  it('a stock the manager typed IS sent', async () => {
    const dish = { ...steak(), stock: 2 } as unknown as Dish;
    const { calls } = mockFetch(() => dish);
    const onClose = vi.fn();
    renderApp(<DishFormDialog dish={dish} open onClose={onClose} />);
    const stock = screen.getByLabelText(/Portions left/);
    await userEvent.clear(stock);
    await userEvent.type(stock, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]?.body).toMatchObject({ stock: 10 });
  });
});
