import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RevenueDashboard } from './index';
import { id, mockFetch, renderApp } from '../../../test/utils';
import { navigation } from '../../../test/setup';

// The report reads its period from the URL through next/navigation.
let search = '';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }));

beforeEach(() => {
  search = '';
  vi.useFakeTimers({ now: new Date(2025, 5, 15, 12), shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const CONFIG = { timeZone: 'Europe/Kyiv', dayStartHour: 4, today: '2025-06-15' };
/** Answers /config (the server's business day) and every other call with `make`. */
const serve = (make: () => unknown) =>
  mockFetch((url) => (url === '/api/config' ? CONFIG : make()));
const reportCalls = (calls: { url: string }[]) =>
  calls.filter((c) => c.url.startsWith('/api/reports'));

const report = (from: string, to: string) => ({
  from,
  to,
  total: 123456,
  orders: 10,
  days: [
    { day: from, revenue: 100000, orders: 8 },
    { day: to, revenue: 23456, orders: 2 },
  ],
  topDishes: [
    { dishId: id(1), name: 'Ribeye steak', quantity: 12, revenue: 744000 },
    { dishId: id(2), name: 'Borscht', quantity: 30, revenue: 360000 },
  ],
});

describe('RevenueDashboard — the period lives in the URL', () => {
  it('no parameters: the default period (last 30 days) is requested', async () => {
    const { calls } = serve(() => report('2025-05-17', '2025-06-15'));
    renderApp(<RevenueDashboard />);
    await screen.findByTestId('report-total');
    expect(reportCalls(calls)[0]!.url).toBe('/api/reports/revenue?from=2025-05-17&to=2025-06-15');
  });
  it('from/to in the URL are used as they are, and the numbers are formatted (en and uk)', async () => {
    search = 'from=2025-03-01&to=2025-03-31';
    const { calls } = serve(() => report('2025-03-01', '2025-03-31'));
    const en = renderApp(<RevenueDashboard />);
    expect(await screen.findByTestId('report-total')).toHaveTextContent('₴1,234.56');
    expect(screen.getByTestId('report-orders')).toHaveTextContent('10');
    expect(screen.getByTestId('report-average')).toHaveTextContent('₴123.46');
    expect(screen.getByLabelText('From')).toHaveValue('2025-03-01');
    expect(reportCalls(calls)[0]!.url).toBe('/api/reports/revenue?from=2025-03-01&to=2025-03-31');
    en.unmount();
    renderApp(<RevenueDashboard />, { locale: 'uk' });
    expect((await screen.findByTestId('report-total')).textContent?.replace(/\s/g, ' ')).toBe(
      '1 234,56 ₴',
    );
    expect(screen.getByText('Топ страв')).toBeInTheDocument();
  });
  it('top dishes table', async () => {
    search = 'from=2025-03-01&to=2025-03-31';
    serve(() => report('2025-03-01', '2025-03-31'));
    renderApp(<RevenueDashboard />);
    expect(await screen.findByText('Ribeye steak')).toBeInTheDocument();
    expect(screen.getByText('₴7,440.00')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Sold' })).toBeInTheDocument();
  });
  it('changing a date writes the new period into the URL as a NEW history step (Back returns to the previous period)', async () => {
    search = 'from=2025-03-01&to=2025-03-31';
    serve(() => report('2025-03-01', '2025-03-31'));
    renderApp(<RevenueDashboard />);
    await screen.findByTestId('report-total');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-03-10' } });
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        expect.stringContaining('from=2025-03-10&to=2025-03-31'),
      ),
    );
  });
  it('presets: 7 / 30 / 60 days end today', async () => {
    serve(() => report('2025-05-17', '2025-06-15'));
    renderApp(<RevenueDashboard />);
    await screen.findByTestId('report-total');
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: '7 days' }));
    expect(navigation.push).toHaveBeenLastCalledWith('/tables?from=2025-06-09&to=2025-06-15');
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: '60 days' }));
    expect(navigation.push).toHaveBeenLastCalledWith('/tables?from=2025-04-17&to=2025-06-15');
  });
  it('an impossible period is explained at the field and is NEVER sent to the API', async () => {
    search = 'from=2025-01-01&to=2025-03-05'; // 64 days
    const { calls } = serve(() => report('2025-01-01', '2025-03-05'));
    renderApp(<RevenueDashboard />);
    expect(await screen.findByText('Choose at most 60 days')).toBeInTheDocument();
    expect(reportCalls(calls)).toHaveLength(0); // nothing was asked of the report API
  });
  it('reversed dates are explained too', async () => {
    search = 'from=2025-03-10&to=2025-03-01';
    const { calls } = serve(() => report('2025-03-10', '2025-03-01'));
    renderApp(<RevenueDashboard />);
    expect(await screen.findByText('The end date is before the start date')).toBeInTheDocument();
    expect(reportCalls(calls)).toHaveLength(0); // nothing was asked of the report API
  });
  it('no paid checks in the period → a friendly message instead of empty tables', async () => {
    search = 'from=2025-03-01&to=2025-03-02';
    serve(() => ({
      from: '2025-03-01',
      to: '2025-03-02',
      total: 0,
      orders: 0,
      days: [],
      topDishes: [],
    }));
    renderApp(<RevenueDashboard />);
    expect(await screen.findByText('No paid checks in this period.')).toBeInTheDocument();
  });
  it('the period error is tied to BOTH date fields for screen readers', async () => {
    search = 'from=2025-03-10&to=2025-03-01';
    serve(() => report('2025-03-10', '2025-03-01'));
    renderApp(<RevenueDashboard />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('id', 'period-error');
    for (const label of ['From', 'To']) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', 'period-error');
    }
  });
  it('chart tooltips and the screen-reader text show a readable date, not the ISO text', async () => {
    search = 'from=2025-03-01&to=2025-03-31';
    serve(() => report('2025-03-01', '2025-03-31'));
    const { container } = renderApp(<RevenueDashboard />);
    await screen.findByTestId('report-total');
    const titles = [...container.querySelectorAll('li[title]')].map((l) => l.getAttribute('title'));
    expect(titles[0]).toBe('March 1: ₴1,000.00');
    expect(titles.join()).not.toMatch(/2025-03/);
  });
});
