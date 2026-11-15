import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@app/shared';
import { PaymentForm, evaluatePayment } from './index';
import { apiError, id, makeItem, makeOrder, mockFetch, renderApp } from '../../../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const sent = makeOrder({
  version: 6,
  items: [makeItem(1, { unitPrice: 61244 })],
  subtotal: 61244,
  total: 61244,
  remaining: 61244,
  guests: 2,
}) as unknown as Order;
const paidResult = (p: {
  id: string;
  amount: number;
  method: 'cash' | 'card';
  tendered?: number;
}) => ({
  replayed: false,
  payment: {
    id: p.id,
    method: p.method,
    amount: p.amount,
    tendered: p.tendered ?? null,
    change: p.tendered ? p.tendered - p.amount : 0,
    label: null,
    createdAt: '2025-06-01T10:00:00.000Z',
  },
  order: {
    ...sent,
    status: 'paid',
    version: 7,
    paidAmount: p.amount,
    remaining: 0,
    paidAt: '2025-06-01T10:30:00.000Z',
  },
});

describe('evaluatePayment (pure rules, same as the server)', () => {
  const order = { remaining: 10000 };
  it('cash: change = tendered − amount', () => {
    const d = evaluatePayment({ method: 'cash', amountText: '73,50', tenderedText: '100' }, order);
    expect(d).toMatchObject({ amount: 7350, tendered: 10000, change: 2650, valid: true });
  });
  it('cash must cover the amount; card needs no tender', () => {
    expect(
      evaluatePayment({ method: 'cash', amountText: '73,50', tenderedText: '70' }, order).problems
        .tendered,
    ).toBe('low');
    expect(
      evaluatePayment({ method: 'cash', amountText: '73,50', tenderedText: '' }, order).problems
        .tendered,
    ).toBe('invalid');
    expect(
      evaluatePayment({ method: 'card', amountText: '73,50', tenderedText: '' }, order),
    ).toMatchObject({ valid: true, tendered: null, change: null });
  });
  it('amount rules: invalid, zero, above the remaining balance', () => {
    expect(
      evaluatePayment({ method: 'card', amountText: 'abc', tenderedText: '' }, order).problems
        .amount,
    ).toBe('invalid');
    expect(
      evaluatePayment({ method: 'card', amountText: '0', tenderedText: '' }, order).problems.amount,
    ).toBe('zero');
    expect(
      evaluatePayment({ method: 'card', amountText: '100,01', tenderedText: '' }, order).problems
        .amount,
    ).toBe('tooMuch');
    expect(
      evaluatePayment({ method: 'card', amountText: '100', tenderedText: '' }, order).valid,
    ).toBe(true);
  });
});

const setup = (over: Partial<Parameters<typeof PaymentForm>[0]> = {}) => {
  const view = renderApp(<PaymentForm order={sent} suggestedAmount={61244} {...over} />);
  view.client.setQueryData(['order', sent.id], sent);
  return view;
};

describe('PaymentForm', () => {
  it('prefills the amount, shows the change live for cash', async () => {
    setup();
    expect(screen.getByLabelText('Amount to pay')).toHaveValue('612.44');
    await userEvent.type(screen.getByLabelText('Cash received'), '700');
    expect(screen.getByTestId('change')).toHaveTextContent('Change: ₴87.56');
  });
  it('field errors appear at the fields after a submit attempt; nothing is sent', async () => {
    const { fn } = mockFetch(() => paidResult({ id: id(1), amount: 1, method: 'card' }));
    setup();
    await userEvent.type(screen.getByLabelText('Cash received'), '100'); // less than 612.44
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText('Less than the amount to pay')).toBeInTheDocument();
    expect(fn).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Amount to pay'));
    await userEvent.type(screen.getByLabelText('Amount to pay'), '9999');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText(/More than what is left/)).toBeInTheDocument();
  });
  it('sends one payment with the client-generated id, amount in kopecks and the check version', async () => {
    const { calls } = mockFetch((_u, init) =>
      paidResult({
        id: JSON.parse(String(init?.body)).id,
        amount: 61244,
        method: 'cash',
        tendered: 70000,
      }),
    );
    setup();
    await userEvent.type(screen.getByLabelText('Cash received'), '700');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toBe(`/api/orders/${sent.id}/payments`);
    expect(calls[0]!.body).toMatchObject({
      method: 'cash',
      amount: 61244,
      tendered: 70000,
      expectedVersion: 6,
    });
    expect((calls[0]!.body as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('Change given: ₴87.56')).toBeInTheDocument();
  });
  it('DOUBLE CLICK → one request, one payment id', async () => {
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => (release = r));
    const { calls } = mockFetch(async (_u, init) => {
      await gate;
      return paidResult({ id: JSON.parse(String(init?.body)).id, amount: 61244, method: 'card' });
    });
    setup();
    await userEvent.click(screen.getByLabelText('Card (confirmed on the terminal)'));
    const button = screen.getByRole('button', { name: 'Record payment' });
    await userEvent.dblClick(button);
    await userEvent
      .click(screen.getByRole('button', { name: /Processing/ }))
      .catch(() => undefined);
    release(null);
    // the request finishes and the form is usable again
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled(),
    );
    expect(calls).toHaveLength(1); // the second click never produced a second request
  });
  it('NETWORK DROP → retried automatically with the SAME payment id, one successful payment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let attempt = 0;
    const ids: string[] = [];
    const fn = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      ids.push(body.id);
      if (++attempt < 3) throw new TypeError('Failed to fetch');
      return new Response(
        JSON.stringify(paidResult({ id: body.id, amount: 61244, method: 'card' })),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fn);
    setup();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByLabelText('Card (confirmed on the terminal)'));
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText(/Retrying safely with the same payment id/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(3));
    expect(new Set(ids).size).toBe(1); // the idempotency key never changed
    await waitFor(() => expect(screen.queryByText(/Retrying safely/)).not.toBeInTheDocument());
  });
  it('after the server says the check changed, the error is explained in the user language', async () => {
    mockFetch(() => apiError(409, 'VERSION_CONFLICT'));
    setup();
    await userEvent.click(screen.getByLabelText('Card (confirmed on the terminal)'));
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument();
  });
  it('a new payment id is used once the cashier edits the amount', async () => {
    const seen: string[] = [];
    mockFetch((_u, init) => {
      const b = JSON.parse(String(init?.body)) as { id: string };
      seen.push(b.id);
      return apiError(422, 'VALIDATION_FAILED');
    });
    setup();
    await userEvent.click(screen.getByLabelText('Card (confirmed on the terminal)'));
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(seen).toHaveLength(1));
    await userEvent.clear(screen.getByLabelText('Amount to pay'));
    await userEvent.type(screen.getByLabelText('Amount to pay'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[0]).not.toBe(seen[1]);
  });
  it('the amount follows the chosen split part', async () => {
    const { rerender } = setup({ suggestedAmount: 20415 });
    expect(screen.getByLabelText('Amount to pay')).toHaveValue('204.15');
    rerender(<PaymentForm order={sent} suggestedAmount={20414} />);
  });
});
