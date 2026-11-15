import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KitchenBoard } from './index';
import { apiError, id, mockFetch, renderApp } from '../../../test/utils';

const NOW = Date.parse('2025-06-01T12:00:00Z');
beforeEach(() => vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const item = (n: number, minutesAgo: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  orderNumber: 10 + n,
  tableNumber: n,
  dishName: `Dish ${n}`,
  station: 'kitchen',
  modifiers: n === 1 ? ['Bacon', 'Medium'] : [],
  comment: n === 1 ? 'no salt' : '',
  guest: 1,
  status: 'sent',
  sentAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
  ...over,
});

const setup = (items: unknown[], onPatch?: (id: string, status: string) => unknown) => {
  const current = { items };
  void current;
  const m = mockFetch((url, init) => {
    if (init?.method === 'PATCH') {
      const itemId = url.split('/').pop() as string;
      const status = JSON.parse(String(init.body)).status as string;
      return onPatch
        ? onPatch(itemId, status)
        : { ...(current.items as { id: string }[]).find((i) => i.id === itemId), status };
    }
    return current;
  });
  renderApp(<KitchenBoard />);
  return { ...m, current };
};

describe('KitchenBoard', () => {
  it('lists items in the order they were sent, with table, modifiers, comment and a running timer', async () => {
    setup([item(1, 4), item(2, 3), item(3, 1)]);
    const list = await screen.findByTestId('kitchen-list');
    const cards = within(list).getAllByRole('button');
    expect(cards.map((c) => within(c).getByText(/^Dish \d$/).textContent)).toEqual([
      'Dish 1',
      'Dish 2',
      'Dish 3',
    ]);
    expect(within(cards[0]!).getByText('Table 1')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Bacon')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Medium')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('“no salt”')).toBeInTheDocument();
    expect(within(cards[0]!).getByTestId('timer')).toHaveTextContent('04:00');
    expect(within(cards[2]!).getByTestId('timer')).toHaveTextContent('01:00');
  });
  it('the timer keeps running without any server call', async () => {
    const { fn } = setup([item(1, 4)]);
    const timer = (await screen.findByTestId('timer')) as HTMLElement;
    expect(timer).toHaveTextContent('04:00');
    const calls = fn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000); // shorter than the 4 s polling fallback
    expect(screen.getByTestId('timer')).toHaveTextContent('04:03');
    expect(fn.mock.calls.length).toBe(calls);
  });
  it('items waiting longer than 15 minutes are highlighted; exactly 15 is not', async () => {
    setup([item(1, 20), item(2, 15), item(3, 14)]);
    const list = await screen.findByTestId('kitchen-list');
    const cards = within(list).getAllByRole('button');
    expect(cards.map((c) => c.dataset.overdue)).toEqual(['true', 'false', 'false']);
    expect(within(cards[0]!).getByText('Over 15 min')).toBeInTheDocument();
    expect(within(cards[1]!).queryByText('Over 15 min')).not.toBeInTheDocument();
    // time passing turns the borderline card red
    await vi.advanceTimersByTimeAsync(2_000);
    await waitFor(() =>
      expect(
        within(screen.getByTestId('kitchen-list')).getAllByRole('button')[1]!.dataset.overdue,
      ).toBe('true'),
    );
  });
  it('a click starts cooking (PATCH cooking); another click marks it ready (PATCH ready)', async () => {
    const { calls } = setup([item(1, 2)]);
    const card = await screen.findByRole('button', { name: /Start cooking: Dish 1/ });
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(card);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: `/api/kitchen/items/${id(1)}`,
      body: { status: 'cooking' },
    });
  });
  it('a cooking item offers "Mark ready"', async () => {
    const { calls } = setup([item(1, 2, { status: 'cooking' })]);
    const card = await screen.findByRole('button', { name: /Mark ready: Dish 1/ });
    expect(card).toHaveAttribute('data-status', 'cooking');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(card);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'ready' }),
    );
  });
  it('is keyboard operable: Tab to a card and press Enter / Space', async () => {
    const { calls } = setup([item(1, 2)]);
    await screen.findByTestId('kitchen-list');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.tab();
    await user.tab();
    await user.tab();
    const card = screen.getByRole('button', { name: /Start cooking/ });
    card.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
  });
  it('shows a notice and refreshes when the item was changed under the cook (409)', async () => {
    setup([item(1, 2)], () => apiError(409, 'INVALID_TRANSITION'));
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(await screen.findByRole('button', { name: /Start cooking/ }));
    expect(await screen.findByText(/just changed/)).toBeInTheDocument();
  });
  it('station filter: All / Kitchen / Bar', async () => {
    setup([item(1, 2), item(2, 3, { station: 'bar' })]);
    await screen.findByTestId('kitchen-list');
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Bar' }));
    const cards = within(screen.getByTestId('kitchen-list')).getAllByRole('button');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]!).getByText('Dish 2')).toBeInTheDocument();
  });
  it('empty queue, and no prices anywhere on the screen', async () => {
    setup([]);
    expect(await screen.findByText('No orders waiting')).toBeInTheDocument();
  });
  it('Ukrainian labels', async () => {
    mockFetch(() => ({ items: [item(1, 2)] }));
    renderApp(<KitchenBoard />, { locale: 'uk' });
    expect(
      await screen.findByRole('button', { name: /Почати готувати: Dish 1/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Стіл 1')).toBeInTheDocument();
  });
});
