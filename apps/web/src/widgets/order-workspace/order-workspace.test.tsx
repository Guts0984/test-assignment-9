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
            { path: id(301), message: 'Last lamb: 0 left, 1 requested' },
          ])
        : undefined,
    );
    renderApp(<OrderWorkspace orderId={state.order.id} />);
    await userEvent.click(await screen.findByRole('button', { name: /Send to kitchen/ }));
    expect(await screen.findByText('Not enough portions left.')).toBeInTheDocument();
    // our own wording (the server's English detail text is not shown), with the dish name from the check
    expect(
      screen.getByText('Dish 1: not enough portions, or no longer on the menu'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 left, 1 requested/)).not.toBeInTheDocument();
    // an out-of-stock answer has its own message; it is not dressed up as "changed elsewhere, repeat"
    expect(screen.queryByText(/changed elsewhere and has been reloaded/)).not.toBeInTheDocument();
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
  it('the payment history shows a part payment in the viewer language, not the stored key', async () => {
    const partly = {
      items: [makeItem(1, { status: 'served' })],
      subtotal: 10000,
      total: 10000,
      paidAmount: 4000,
      remaining: 6000,
      payments: [
        {
          id: id(900),
          method: 'card',
          amount: 4000,
          tendered: null,
          change: 0,
          label: 'guest:2',
          createdAt: '2025-06-01T10:30:00.000Z',
        },
      ],
    };
    serve({ order: base(partly), menu: [soup] });
    renderApp(<OrderWorkspace orderId={id(100)} />);
    await userEvent.click(await screen.findByRole('button', { name: /^Pay$/ }));
    expect(await screen.findByText('Card · Guest 2')).toBeInTheDocument();
    expect(screen.queryByText(/guest:2/)).not.toBeInTheDocument();
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

  it('A FAILED REFRESH KEEPS THE SCREEN: the check, an open dialog and typed text stay; a notice is added', async () => {
    const state: State = {
      order: base({
        items: [makeItem(1, { status: 'sent' })],
        subtotal: 10000,
        total: 10000,
        remaining: 10000,
      }),
      menu: [soup],
    };
    let down = false;
    serve(state, (url) => (down && url !== '/api/me' ? apiError(500, 'INTERNAL') : undefined));
    const view = renderApp(<OrderWorkspace orderId={state.order.id} />);
    await userEvent.click(await screen.findByRole('button', { name: /^Soup, / }));
    const comment = await screen.findByLabelText(/Comment/);
    await userEvent.type(comment, 'allergy: nuts');

    down = true; // the API is down for a while
    await view.client.invalidateQueries({ queryKey: ['order'] });
    await view.client.invalidateQueries({ queryKey: ['menu'] });
    expect(await screen.findByText(/Cannot refresh right now/)).toBeInTheDocument();
    // everything is still there
    expect(screen.getByText('Dish 1')).toBeInTheDocument();
    expect(screen.getByLabelText(/Comment/)).toHaveValue('allergy: nuts');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a menu that cannot be loaded says so (it must not look like an empty menu)', async () => {
    serve({ order: base(), menu: [] }, (url) =>
      url === '/api/menu' ? apiError(500, 'INTERNAL') : undefined,
    );
    renderApp(<OrderWorkspace orderId={id(100)} />);
    expect(await screen.findByText(/server had a problem/)).toBeInTheDocument();
  });

  it('a check closed without a bill says so', async () => {
    serve({ order: base({ status: 'closed', subtotal: 0, total: 0 }), menu: [soup] });
    renderApp(<OrderWorkspace orderId={id(100)} />);
    expect(await screen.findByText(/closed without a bill/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay' })).not.toBeInTheDocument();
  });

  it('the version number is not shown to the waiter', async () => {
    serve({ order: base({ version: 7, items: [makeItem(1)] }), menu: [soup] });
    renderApp(<OrderWorkspace orderId={id(100)} />);
    await screen.findByText('Dish 1');
    expect(screen.queryByText(/v7/)).not.toBeInTheDocument();
  });

  it('with items not served yet: a hint before Pay is pressed, and a warning in the payment dialog with the form off', async () => {
    serve({
      order: base({
        items: [makeItem(1, { status: 'ready' }), makeItem(2, { status: 'served' })],
        subtotal: 20000,
        total: 20000,
        remaining: 20000,
      }),
      menu: [soup],
    });
    renderApp(<OrderWorkspace orderId={id(100)} />);
    expect(await screen.findByText(/Payment opens once every item is served/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pay' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/1 item is not served yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Record payment' })).toBeDisabled();
  });

  it('fully served: no hint, and the payment form is on', async () => {
    serve({
      order: base({
        items: [makeItem(1, { status: 'served' })],
        subtotal: 10000,
        total: 10000,
        remaining: 10000,
      }),
      menu: [soup],
    });
    renderApp(<OrderWorkspace orderId={id(100)} />);
    await screen.findByText('Dish 1');
    expect(screen.queryByText(/Payment opens once/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pay' }));
    expect(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Record payment' }),
    ).toBeEnabled();
  });

  it('a failed "Served" click says why, next to the item', async () => {
    const state: State = {
      order: base({
        items: [makeItem(1, { status: 'ready' })],
        subtotal: 10000,
        total: 10000,
        remaining: 10000,
      }),
      menu: [soup],
    };
    serve(state, (url, init) =>
      init?.method === 'PATCH' && url.includes('/items/') ? apiError(500, 'INTERNAL') : undefined,
    );
    renderApp(<OrderWorkspace orderId={state.order.id} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Served' }));
    expect(await screen.findByText(/server had a problem/)).toBeInTheDocument();
  });

  it('a version conflict raises the "changed elsewhere" notice; an out-of-stock answer does not', async () => {
    const state: State = {
      order: base({ items: [makeItem(1, { status: 'draft', sentAt: null })] }),
      menu: [soup],
    };
    let code = 'VERSION_CONFLICT';
    serve(state, (url, init) =>
      url.endsWith('/send') && init?.method === 'POST' ? apiError(409, code) : undefined,
    );
    renderApp(<OrderWorkspace orderId={state.order.id} />);
    await userEvent.click(await screen.findByRole('button', { name: /Send to kitchen/ }));
    expect(await screen.findByText(/changed elsewhere and has been reloaded/)).toBeInTheDocument();
    code = 'ORDER_PARTIALLY_PAID';
    await userEvent.click(screen.getByRole('button', { name: /Send to kitchen/ }));
    expect(await screen.findByText(/Part of this check is already paid/)).toBeInTheDocument();
  });

  it('the guest count can be changed: + sends PATCH with the version; − is off at the lowest guest in use', async () => {
    const state: State = {
      order: base({ guests: 3, version: 4, items: [makeItem(1, { guest: 3 })] }),
      menu: [soup],
    };
    const { calls } = serve(state, (url, init) =>
      url === `/api/orders/${state.order.id}` && init?.method === 'PATCH'
        ? { ...state.order, guests: 4, version: 5 }
        : undefined,
    );
    renderApp(<OrderWorkspace orderId={state.order.id} />);
    await screen.findByText('Dish 1');
    expect(screen.getByRole('button', { name: 'Fewer guests' })).toBeDisabled(); // guest 3 has an item
    await userEvent.click(screen.getByRole('button', { name: 'More guests' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      guests: 4,
      expectedVersion: 4,
    });
    expect(await screen.findByText('4 guests')).toBeInTheDocument();
  });

  it('another waiter’s check has no guest buttons', async () => {
    serve({ order: base({ waiterId: id(99) }), menu: [soup] });
    renderApp(<OrderWorkspace orderId={id(100)} />);
    await screen.findByText(/another waiter's check/);
    expect(screen.queryByRole('button', { name: 'More guests' })).not.toBeInTheDocument();
  });

  it('closing the payment that finished the check: the change is still shown', async () => {
    const open = base({
      items: [makeItem(1, { status: 'served' })],
      subtotal: 10000,
      total: 10000,
      remaining: 10000,
    });
    const paidOrder = {
      ...open,
      status: 'paid',
      paidAmount: 10000,
      remaining: 0,
      version: 1,
      paidAt: '2025-06-01T10:30:00.000Z',
    };
    let paid = false;
    serve({ order: open, menu: [soup] }, (url, init) => {
      if (url === `/api/orders/${open.id}/payments` && init?.method === 'POST') {
        paid = true;
        return {
          replayed: false,
          payment: {
            id: id(900),
            method: 'cash',
            amount: 10000,
            tendered: 12000,
            change: 2000,
            label: null,
            createdAt: '2025-06-01T10:30:00.000Z',
          },
          order: paidOrder,
        };
      }
      if (url === `/api/orders/${open.id}` && paid) return paidOrder;
      return undefined;
    });
    renderApp(<OrderWorkspace orderId={open.id} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pay' }));
    await userEvent.type(await screen.findByLabelText('Cash received'), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText('Check paid in full')).toBeInTheDocument();
    expect(screen.getByText('Give the guest change: ₴20.00')).toBeInTheDocument();
  });
});
