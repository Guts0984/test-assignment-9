import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@app/shared';
import { OrderWorkspace } from './index';
import {
  apiError,
  id,
  makeItem,
  makeOrder,
  mockFetch,
  renderApp,
  steak,
} from '../../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const ME = { id: id(2), username: 'waiter1', displayName: 'Olena', role: 'waiter' };
const soup = {
  ...steak(),
  id: id(600),
  name: 'Soup',
  category: 'Soups',
  price: 12000,
  modifierGroups: [],
};
const lamb = {
  ...steak(),
  id: id(601),
  name: 'Last lamb',
  category: 'Mains',
  price: 50000,
  stock: 0,
  stopListed: true,
  modifierGroups: [],
};

type State = { order: Order; menu: unknown[] };
const serve = (state: State, extra?: (url: string, init: RequestInit | undefined) => unknown) =>
  mockFetch((url, init) => {
    const custom = extra?.(url, init);
    if (custom !== undefined) return custom;
    if (url === '/api/me') return ME;
    if (url === '/api/menu') return { dishes: state.menu };
    if (url.startsWith('/api/orders/')) return state.order;
    return apiError(404, 'NOT_FOUND');
  });

const base = (over: Record<string, unknown> = {}) =>
  makeOrder({ guests: 2, ...over }) as unknown as Order;

describe('OrderWorkspace', () => {
  it('shows the menu by category, with stop-listed dishes disabled', async () => {
    serve({ order: base(), menu: [steak(), soup, lamb] });
    renderApp(<OrderWorkspace orderId={id(100)} />);
    expect(await screen.findByRole('button', { name: /^Soup, ₴120.00/ })).toBeEnabled();
    const stopped = screen.getByRole('button', { name: /Last lamb.*Stop-list/ });
    expect(stopped).toBeDisabled();
    expect(within(stopped).getByText('Stop-list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Soups' })).toBeInTheDocument();
  });
  it('items per guest with status badges; totals include the service fee for 6+ guests', async () => {
    const order = base({
      guests: 6,
      items: [
        makeItem(1, { guest: 1, status: 'cooking', unitPrice: 20000 }),
        makeItem(2, { guest: 2, status: 'ready', unitPrice: 10000 }),
      ],
      subtotal: 30000,
      serviceFee: 3000,
      total: 33000,
      remaining: 33000,
    });
    serve({ order, menu: [soup] });
    renderApp(<OrderWorkspace orderId={order.id} />);
    expect(await screen.findByText('Dish 1')).toBeInTheDocument();
    expect(screen.getByText('Guest 1')).toBeInTheDocument();
    expect(
      within(screen.getByText('Dish 1').closest('li')!).getByText('Cooking'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText('Dish 2').closest('li')!).getByText('Ready'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('subtotal')).toHaveTextContent('₴300.00');
    expect(screen.getByTestId('service-fee')).toHaveTextContent('₴30.00');
    expect(screen.getByTestId('total')).toHaveTextContent('₴330.00');
  });
  it('no service fee line below 6 guests', async () => {
    const order = base({
      guests: 5,
      items: [makeItem(1)],
      subtotal: 10000,
      total: 10000,
      remaining: 10000,
    });
    serve({ order, menu: [soup] });
    renderApp(<OrderWorkspace orderId={order.id} />);
    await screen.findByText('Dish 1');
    expect(screen.queryByTestId('service-fee')).not.toBeInTheDocument();
    expect(screen.getByTestId('total')).toHaveTextContent('₴100.00');
  });
  it('STATUS UPDATES THEMSELVES: a refetch after a server event flips cooking → ready without a reload', async () => {
    const state: State = {
      order: base({
        items: [makeItem(1, { status: 'cooking' })],
        subtotal: 10000,
        total: 10000,
        remaining: 10000,
      }),
      menu: [soup],
    };
    serve(state);
    const view = renderApp(<OrderWorkspace orderId={state.order.id} />);
    const row = async () => (await screen.findByText('Dish 1')).closest('li')!;
    expect(within(await row()).getByText('Cooking')).toBeInTheDocument();
    // …the cook marks it ready; the SSE event makes the app invalidate this check:
    state.order = { ...state.order, items: [makeItem(1, { status: 'ready' })] } as Order;
    await view.client.invalidateQueries({ queryKey: ['order', state.order.id] });
    await waitFor(async () => expect(within(await row()).getByText('Ready')).toBeInTheDocument());
    expect(within(await row()).getByRole('button', { name: 'Served' })).toBeInTheDocument();
  });
  it('a draft whose dish just hit the stop-list is flagged and blocks "Send to kitchen"', async () => {
    const state: State = {
      order: base({ items: [makeItem(1, { status: 'draft', sentAt: null })] }),
      menu: [soup],
    };
    serve(state);
    const view = renderApp(<OrderWorkspace orderId={state.order.id} />);
    await screen.findByText('Dish 1');
    expect(screen.getByRole('button', { name: /Send to kitchen/ })).toBeEnabled();
    state.order = {
      ...state.order,
      items: [makeItem(1, { status: 'draft', sentAt: null, unavailable: true })],
    } as Order;
    await view.client.invalidateQueries();
    expect(await screen.findByText('No longer available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send to kitchen/ })).toBeDisabled();
    expect(screen.getByText('Remove it before sending')).toBeInTheDocument();
  });
  it('sending: one POST with the current version; drafts become "sent" from the response', async () => {
    const state: State = {
      order: base({ version: 4, items: [makeItem(1, { status: 'draft', sentAt: null })] }),
      menu: [soup],
    };
    const { calls } = serve(state, (url, init) => {
      if (url.endsWith('/send') && init?.method === 'POST') {
        state.order = {
          ...state.order,
          version: 5,
          items: [makeItem(1, { status: 'sent' })],
        } as Order;
        return state.order;
      }
      return undefined;
    });
    renderApp(<OrderWorkspace orderId={state.order.id} />);
    await userEvent.click(await screen.findByRole('button', { name: /Send to kitchen/ }));
    await waitFor(() =>
      expect(
        within(screen.getByText('Dish 1').closest('li')!).getByText('Sent'),
      ).toBeInTheDocument(),
    );
    const post = calls.filter((c) => c.method === 'POST');
    expect(post).toHaveLength(1);
    expect(post[0]).toMatchObject({
      url: `/api/orders/${state.order.id}/send`,
      body: { expectedVersion: 4 },
    });
  });
  it('out of stock on send: the server reason is shown and the check is reloaded', async () => {
    const state: State = {
      order: base({ items: [makeItem(1, { status: 'draft', sentAt: null })] }),
      menu: [soup],
    };
    serve(state, (url, init) =>
      url.endsWith('/send') && init?.method === 'POST'
        ? apiError(409, 'OUT_OF_STOCK', 'x', [
            { path: id(1), message: 'Last lamb: 0 left, 1 requested' },
          ])
        : undefined,
    );
    renderApp(<OrderWorkspace orderId={state.order.id} />);
    await userEvent.click(await screen.findByRole('button', { name: /Send to kitchen/ }));
    expect(await screen.findByText('Not enough portions left.')).toBeInTheDocument();
    expect(screen.getByText('Last lamb: 0 left, 1 requested')).toBeInTheDocument();
    expect(await screen.findByText(/changed elsewhere and has been reloaded/)).toBeInTheDocument();
  });
  it('another waiter’s check is read-only: no actions, an explanation', async () => {
    serve({
      order: base({ waiterId: id(99), items: [makeItem(1, { status: 'draft', sentAt: null })] }),
      menu: [soup],
    });
    renderApp(<OrderWorkspace orderId={id(100)} />);
    expect(await screen.findByText(/another waiter's check/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send to kitchen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Soup, / })).toBeDisabled();
  });
  it('a paid check can no longer be changed', async () => {
    serve({
      order: base({
        status: 'paid',
        paidAt: '2025-06-01T11:00:00Z',
        items: [makeItem(1, { status: 'served' })],
        subtotal: 10000,
        total: 10000,
        paidAmount: 10000,
      }),
      menu: [soup],
    });
    renderApp(<OrderWorkspace orderId={id(100)} />);
    expect(await screen.findByText(/paid and can no longer be changed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send to kitchen/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Soup, / })).toBeDisabled();
  });
  it('cancel is offered before cooking, not after', async () => {
    serve({
      order: base({
        items: [
          makeItem(1, { status: 'sent' }),
          makeItem(2, { status: 'cooking' }),
          makeItem(3, { status: 'draft', sentAt: null }),
        ],
      }),
      menu: [soup],
    });
    renderApp(<OrderWorkspace orderId={id(100)} />);
    await screen.findByText('Dish 1');
    const row = (name: string) => screen.getByText(name).closest('li')!;
    expect(within(row('Dish 1')).getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
    expect(within(row('Dish 2')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(row('Dish 3')).getByRole('button', { name: /Remove/ })).toBeInTheDocument();
  });
  it('opens the item dialog from the menu; Ukrainian screen text', async () => {
    serve({ order: base(), menu: [soup] });
    renderApp(<OrderWorkspace orderId={id(100)} />, { locale: 'uk' });
    expect(await screen.findByText('Чек №7')).toBeInTheDocument();
    expect(screen.getByText('Ще нічого не замовлено. Оберіть страву з меню.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Soup, / }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
