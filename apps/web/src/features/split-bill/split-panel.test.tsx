import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@app/shared';
import { SplitPanel, paidPartFlags } from './index';
import { apiError, makeItem, makeOrder, mockFetch, renderApp } from '../../../test/utils';

afterEach(() => vi.unstubAllGlobals());

// 7 guests, subtotal 556,76 + 10% fee = 612,44 (the same check as in the API tests)
const order = makeOrder({
  guests: 7,
  version: 5,
  items: [
    makeItem(1, { unitPrice: 33333, guest: 1 }),
    makeItem(2, { unitPrice: 12345, guest: 2 }),
    makeItem(3, { unitPrice: 9998, guest: 3 }),
  ],
  subtotal: 55676,
  serviceFee: 5568,
  total: 61244,
  remaining: 61244,
}) as unknown as Order;

const parts = () =>
  within(screen.getByTestId('split-parts'))
    .getAllByTestId('part-total')
    .map((e) => e.textContent);

describe('SplitPanel', () => {
  it('equal split on 3: 204,15 + 204,15 + 204,14 and a "sums to" line equal to the total', async () => {
    mockFetch((url) => {
      void url;
      return apiError(500, 'INTERNAL'); // even with the server down the local calculation is shown
    });
    renderApp(<SplitPanel order={order} onPick={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Split equally'));
    expect(parts()).toEqual(['₴204.15', '₴204.15', '₴204.14']);
    expect(screen.getByText('Parts add up to ₴612.44')).toBeInTheDocument();
  });
  it('asks the server for the authoritative split and shows its numbers', async () => {
    const { calls } = mockFetch(() => ({
      mode: 'equal',
      total: 61244,
      parts: [
        { index: 1, guest: null, subtotal: 18568, serviceFee: 1857, total: 20425 }, // deliberately different
        { index: 2, guest: null, subtotal: 18568, serviceFee: 1856, total: 20424 },
        { index: 3, guest: null, subtotal: 18540, serviceFee: 1855, total: 20395 },
      ],
    }));
    renderApp(<SplitPanel order={order} onPick={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Split equally'));
    await waitFor(() => expect(parts()).toEqual(['₴204.25', '₴204.24', '₴203.95']));
    expect(calls[0]).toMatchObject({
      url: `/api/orders/${order.id}/split`,
      method: 'POST',
      body: { mode: 'equal', parts: 3 },
    });
  });
  it('per guest: one line per guest who ordered', async () => {
    mockFetch(() => apiError(500, 'INTERNAL'));
    renderApp(<SplitPanel order={order} onPick={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('By guest'));
    const list = screen.getByTestId('split-parts');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Guest 1')).toBeInTheDocument();
    expect(parts().reduce((a, t) => a + Number(t!.replace(/[^\d]/g, '')), 0)).toBe(61244);
  });
  it('"Pay this part" hands the part amount to the payment form', async () => {
    mockFetch(() => apiError(500, 'INTERNAL'));
    const onPick = vi.fn();
    renderApp(<SplitPanel order={order} onPick={onPick} />);
    await userEvent.click(screen.getByLabelText('Split equally'));
    await userEvent.click(
      within(screen.getByTestId('split-parts')).getAllByRole('button', {
        name: 'Pay this part',
      })[2]!,
    );
    expect(onPick).toHaveBeenCalledWith(20414, 'Part 3');
  });
  it('parts already covered by payments are marked paid and disabled', async () => {
    mockFetch(() => apiError(500, 'INTERNAL'));
    const half = {
      ...order,
      paidAmount: 40830,
      remaining: 20414,
      payments: [
        { id: 'p1', method: 'card', amount: 20415, tendered: null, change: 0, label: 'Part 1' },
        { id: 'p2', method: 'card', amount: 20415, tendered: null, change: 0, label: 'Part 2' },
      ],
    } as unknown as Order;
    renderApp(<SplitPanel order={half} onPick={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Split equally'));
    const buttons = within(screen.getByTestId('split-parts')).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Paid', 'Paid', 'Pay this part']);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[2]).toBeEnabled();
  });
  it('guest 2 paid first: guest 1 is still offered and guest 2 is the one marked paid', async () => {
    mockFetch(() => apiError(500, 'INTERNAL'));
    const g2 = {
      ...order,
      paidAmount: 12345,
      remaining: order.total - 12345,
      payments: [
        { id: 'p1', method: 'card', amount: 20000, tendered: null, change: 0, label: 'Guest 2' },
      ],
    } as unknown as Order;
    renderApp(<SplitPanel order={g2} onPick={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('By guest'));
    const rows = within(screen.getByTestId('split-parts')).getAllByRole('listitem');
    const state = (row: HTMLElement) => within(row).getByRole('button');
    expect(state(rows[0]!)).toBeEnabled();
    expect(state(rows[0]!)).toHaveTextContent('Pay this part');
    expect(state(rows[1]!)).toBeDisabled();
    expect(state(rows[1]!)).toHaveTextContent('Paid');
  });
  it('the number of parts is validated at the field (2…50)', async () => {
    const { fn } = mockFetch(() => apiError(500, 'INTERNAL'));
    renderApp(<SplitPanel order={order} onPick={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Split equally'));
    const input = screen.getByLabelText('Number of parts');
    await userEvent.clear(input);
    await userEvent.type(input, '1');
    expect(await screen.findByRole('alert')).toHaveTextContent('whole number from 2 to 50');
    expect(screen.queryByTestId('split-parts')).not.toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '51');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '4');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(parts()).toHaveLength(4);
    void fn;
  });
  it('is operable from the keyboard: arrow keys change the split mode', async () => {
    mockFetch(() => apiError(500, 'INTERNAL'));
    renderApp(<SplitPanel order={order} onPick={vi.fn()} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByLabelText('Whole check')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByLabelText('Split equally')).toBeChecked();
  });
});

describe('paidPartFlags', () => {
  const parts = [
    { total: 5000, label: 'Guest 1' },
    { total: 10000, label: 'Guest 2' },
  ];
  const pay = (label: string | null, amount: number) => ({ label, amount });

  it('payments without a label cover the parts in order', () => {
    const p = [
      { total: 20415, label: 'Part 1' },
      { total: 20415, label: 'Part 2' },
      { total: 20414, label: 'Part 3' },
    ];
    expect(paidPartFlags(p, [])).toEqual([false, false, false]);
    expect(paidPartFlags(p, [pay(null, 20415)])).toEqual([true, false, false]);
    expect(paidPartFlags(p, [pay(null, 40829)])).toEqual([true, false, false]);
    expect(paidPartFlags(p, [pay(null, 61244)])).toEqual([true, true, true]);
  });

  it('a part is paid by the payment that carries ITS label, whatever the order', () => {
    // guest 2 (100,00) paid first: guest 1 must still be payable
    expect(paidPartFlags(parts, [pay('Guest 2', 10000)])).toEqual([false, true]);
    expect(paidPartFlags(parts, [pay('Guest 2', 10000), pay('Guest 1', 5000)])).toEqual([
      true,
      true,
    ]);
  });

  it('a payment smaller than the part does not mark it paid', () => {
    expect(paidPartFlags(parts, [pay('Guest 2', 4000)])).toEqual([false, false]);
  });

  it('labels from another split mode fall back to the in-order rule', () => {
    expect(paidPartFlags(parts, [pay('Part 1', 5000)])).toEqual([true, false]);
  });
});
