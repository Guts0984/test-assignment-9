import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dish, Order } from '@app/shared';
import { AddItemDialog } from './index';
import { apiError, id, makeOrder, mockFetch, renderApp, steak } from '../../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const order = makeOrder({ guests: 3, version: 4 }) as unknown as Order;
const dish = steak() as unknown as Dish;
const ok = () => ({ ...order, version: 5 });

const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) });
const check = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name}`) });

const open = (onClose = vi.fn(), over?: Parameters<typeof renderApp>[1]) => {
  const view = renderApp(<AddItemDialog dish={dish} order={order} onClose={onClose} />, over);
  // seed the cache so the mutation can read the current version
  view.client.setQueryData(['order', order.id], order);
  return { ...view, onClose };
};

describe('AddItemDialog — modifier rules', () => {
  it('"exactly one" is a radio group; "0–3" are checkboxes; rules are stated', () => {
    open();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.getByText(/Choose exactly 1/)).toBeInTheDocument();
    expect(screen.getByText(/Choose up to 3/)).toBeInTheDocument();
  });
  it('submitting without the required choice shows the error at that group and sends nothing', async () => {
    const { fn } = mockFetch(() => ok());
    open();
    await userEvent.click(screen.getByRole('button', { name: /Add to the check/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('“Doneness”: choose at least 1');
    expect(fn).not.toHaveBeenCalled();
  });
  it('too many extras: error under the extras group; fixing it clears the error', async () => {
    mockFetch(() => ok());
    open();
    await userEvent.click(radio('Medium'));
    for (const name of ['Bacon', 'Egg', 'Cheese', 'Mushrooms']) await userEvent.click(check(name));
    await userEvent.click(screen.getByRole('button', { name: /Add to the check/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('“Extras”: choose at most 3');
    await userEvent.click(check('Mushrooms')); // back to 3
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('radio choice replaces the previous one; the price follows the selection live', async () => {
    open();
    expect(screen.getByRole('button', { name: /Add to the check/ })).toHaveTextContent('₴250.00');
    await userEvent.click(radio('Rare'));
    await userEvent.click(radio('Well done'));
    expect(radio('Rare')).not.toBeChecked();
    expect(radio('Well done')).toBeChecked();
    await userEvent.click(check('Bacon'));
    await userEvent.click(check('Egg'));
    expect(screen.getByRole('button', { name: /Add to the check/ })).toHaveTextContent('₴305.00'); // 250 + 35 + 20
  });
  it('sends exactly what the server expects: dish, guest, comment, chosen modifier ids, current version', async () => {
    const { calls } = mockFetch(() => ok());
    const { onClose } = open();
    await userEvent.selectOptions(screen.getByLabelText('Guest'), '2');
    await userEvent.click(radio('Medium'));
    await userEvent.click(check('Bacon'));
    await userEvent.type(screen.getByLabelText('Comment for the kitchen'), 'no salt');
    await userEvent.click(screen.getByRole('button', { name: /Add to the check/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: `/api/orders/${order.id}/items`, method: 'POST' });
    const body = calls[0]!.body as { modifierIds: string[] };
    expect(body).toMatchObject({
      dishId: dish.id,
      guest: 2,
      comment: 'no salt',
      expectedVersion: 4,
    });
    expect([...body.modifierIds].sort()).toEqual([id(512), id(521)].sort());
  });
  it('works from the keyboard: Tab to a radio, Space selects, Enter on the form submits', async () => {
    const { calls } = mockFetch(() => ok());
    open();
    const user = userEvent.setup();
    screen.getByLabelText('Guest').focus();
    await user.tab(); // → first radio group member
    await user.keyboard(' ');
    expect(radio('Rare')).toBeChecked();
    await user.keyboard('{ArrowDown}');
    expect(radio('Medium')).toBeChecked(); // arrow keys move the radio choice
    await user.click(screen.getByLabelText('Comment for the kitchen'));
    await user.keyboard('{Control>}{Enter}{/Control}'); // textarea: Ctrl+Enter does not submit by default
    await user.tab({ shift: true });
    expect(calls).toHaveLength(0);
  });
  it('comment over 200 characters is refused at the field', async () => {
    const { fn } = mockFetch(() => ok());
    open();
    await userEvent.click(radio('Medium'));
    await userEvent.type(screen.getByLabelText('Comment for the kitchen'), 'x'.repeat(201));
    await userEvent.click(screen.getByRole('button', { name: /Add to the check/ }));
    expect(await screen.findByText('At most 200 characters')).toBeInTheDocument();
    expect(fn).not.toHaveBeenCalled();
  });
  it('shows the server reason when the dish ran out meanwhile, and keeps the dialog open', async () => {
    mockFetch(() => apiError(409, 'OUT_OF_STOCK', 'Steak is on the stop-list'));
    const { onClose } = open();
    await userEvent.click(radio('Medium'));
    await userEvent.click(screen.getByRole('button', { name: /Add to the check/ }));
    expect(await screen.findByText('Not enough portions left.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('a modifier violation reported by the server is listed too', async () => {
    mockFetch(() =>
      apiError(422, 'VALIDATION_FAILED', 'Invalid modifier selection', [
        { path: 'modifierIds', message: '"Doneness": choose exactly 1 (got 0)' },
      ]),
    );
    open();
    await userEvent.click(radio('Medium'));
    await userEvent.click(screen.getByRole('button', { name: /Add to the check/ }));
    const alert = await screen.findByText(/Doneness.*choose exactly 1/);
    expect(
      within(alert.closest('[role="alert"]') as HTMLElement).getByText(/choose exactly 1/),
    ).toBeInTheDocument();
  });
  it('Ukrainian: rule text, error text and labels', async () => {
    open(vi.fn(), { locale: 'uk' });
    expect(screen.getByText(/Оберіть рівно 1/)).toBeInTheDocument();
    expect(screen.getByText(/Оберіть до 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Додати до чека/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('«Doneness»: оберіть щонайменше 1');
  });
});
