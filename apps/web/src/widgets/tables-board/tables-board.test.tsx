import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TablesBoard } from './index';
import { apiError, id, mockFetch, renderApp } from '../../../test/utils';
import { navigation } from '../../../test/setup';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const ME = { id: id(2), username: 'waiter1', displayName: 'Olena', role: 'waiter' };
const tables = [
  { id: id(1), number: 1, seats: 2, state: 'free', orderId: null, waiterId: null, readyCount: 0 },
  {
    id: id(2),
    number: 2,
    seats: 4,
    state: 'occupied',
    orderId: id(20),
    waiterId: id(2),
    readyCount: 0,
  },
  {
    id: id(3),
    number: 3,
    seats: 6,
    state: 'ready',
    orderId: id(30),
    waiterId: id(99),
    readyCount: 2,
  },
];

describe('TablesBoard', () => {
  it('shows every table with its state: free, occupied, has ready dishes (and whose it is)', async () => {
    mockFetch((url) => (url === '/api/me' ? ME : { tables }));
    renderApp(<TablesBoard />);
    expect(
      await screen.findByRole('button', { name: /Open the table: Table 1/ }),
    ).toBeInTheDocument();
    const own = screen.getByRole('link', { name: /Table 2, Occupied/ });
    expect(within(own).getByText('Your table')).toBeInTheDocument();
    const ready = screen.getByRole('link', { name: /Table 3, Ready to serve/ });
    expect(within(ready).getByText('2 dishes ready')).toBeInTheDocument();
    expect(within(ready).getByText('Another waiter')).toBeInTheDocument();
    expect(ready).toHaveAttribute('href', `/orders/${id(30)}`);
  });
  it('REFRESHES WITHOUT RELOAD: a table turning "ready" after an event', async () => {
    let data = tables.map((t) => ({ ...t }));
    mockFetch((url) => (url === '/api/me' ? ME : { tables: data }));
    const view = renderApp(<TablesBoard />);
    await screen.findByRole('link', { name: /Table 2, Occupied/ });
    data = data.map((t) => (t.number === 2 ? { ...t, state: 'ready', readyCount: 1 } : t));
    await view.client.invalidateQueries({ queryKey: ['tables'] });
    expect(
      await screen.findByRole('link', { name: /Table 2, Ready to serve/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 dish ready')).toBeInTheDocument();
  });
  it('opening a free table: guests are validated, then a check is created and the waiter is taken to it', async () => {
    const { calls } = mockFetch((url, init) => {
      if (url === '/api/me') return ME;
      if (url === '/api/orders' && init?.method === 'POST') {
        return {
          id: id(77),
          number: 1,
          day: '2025-06-01',
          tableId: id(1),
          waiterId: id(2),
          guests: 4,
          status: 'open',
          version: 0,
          items: [],
          subtotal: 0,
          serviceFee: 0,
          total: 0,
          paidAmount: 0,
          remaining: 0,
          payments: [],
          createdAt: '2025-06-01T10:00:00Z',
          paidAt: null,
        };
      }
      return { tables };
    });
    renderApp(<TablesBoard />);
    await userEvent.click(await screen.findByRole('button', { name: /Open the table: Table 1/ }));
    const guests = await screen.findByLabelText('Number of guests');
    await userEvent.clear(guests);
    await userEvent.type(guests, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Open the table' }));
    expect(await screen.findByText(/whole number from 1 to 50/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.clear(guests);
    await userEvent.type(guests, '4{Enter}');
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/orders/${id(77)}`));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ tableId: id(1), guests: 4 });
  });
  it('someone else opened the table first: the conflict is explained', async () => {
    mockFetch((url, init) =>
      url === '/api/me'
        ? ME
        : url === '/api/orders' && init?.method === 'POST'
          ? apiError(409, 'CONFLICT')
          : { tables },
    );
    renderApp(<TablesBoard />);
    await userEvent.click(await screen.findByRole('button', { name: /Open the table: Table 1/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open the table' }));
    expect(await screen.findByText('That cannot be done right now.')).toBeInTheDocument();
  });
  it('Ukrainian state names and plural', async () => {
    mockFetch((url) => (url === '/api/me' ? ME : { tables }));
    renderApp(<TablesBoard />, { locale: 'uk' });
    expect(await screen.findByText('2 страви готові')).toBeInTheDocument();
    expect(screen.getByText('Вільний')).toBeInTheDocument();
    expect(screen.getByText('4 місця')).toBeInTheDocument();
    expect(screen.getByText('6 місць')).toBeInTheDocument();
  });
});
