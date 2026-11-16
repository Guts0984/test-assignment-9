import { expect, test } from '@playwright/test';
import {
  addDish,
  asRole,
  fetchOrder,
  itemRow,
  kitchenFinishes,
  openCheck,
  payRemainingByCard,
  sendToKitchen,
} from './helpers';

/** Behaviour found wrong by an external audit, checked in a real browser against the real stack. */

test('one event stream for the whole session: moving between screens does not reopen it', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter1');
  try {
    const streams: string[] = [];
    waiter.page.on('request', (r) => {
      if (r.url().endsWith('/api/events')) streams.push(r.url());
    });
    await waiter.page.goto('/en/tables');
    await expect(waiter.page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    // client-side navigation only (openCheck() would reload the page with goto)
    await waiter.page
      .getByRole('button', { name: /^Open the table: Table/ })
      .first()
      .click();
    await waiter.page.getByRole('dialog').getByLabel('Number of guests').fill('2');
    await waiter.page.getByRole('dialog').getByRole('button', { name: 'Open the table' }).click();
    await waiter.page.waitForURL(/\/en\/orders\//); // tables → check
    await waiter.page.getByRole('button', { name: 'Close empty check' }).click();
    await waiter.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close check', exact: true })
      .click(); // check → tables
    await waiter.page.waitForURL('**/en/tables');
    await expect(waiter.page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    expect(streams).toHaveLength(1);
  } finally {
    await waiter.context.close();
  }
});

test('a 6th guest sits down: the number of guests can be raised and the service fee appears', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter1');
  const id = await (async () => {
    await openCheck(waiter.page, 5);
    return waiter.page.url().split('/').pop() as string;
  })();
  try {
    await addDish(waiter.page, 'Cheesecake');
    await sendToKitchen(waiter.page);
    await expect(waiter.page.getByTestId('service-fee')).toHaveCount(0);
    await waiter.page.getByRole('button', { name: 'More guests' }).click();
    await expect(waiter.page.getByText('6 guests')).toBeVisible();
    await expect(waiter.page.getByTestId('service-fee')).toBeVisible();
    const server = await fetchOrder(waiter.context.request, id);
    expect(server.serviceFee).toBeGreaterThan(0);
    // settle it, so the table is not left occupied
    await kitchenFinishes(browser, waiter);
    await waiter.page.getByRole('button', { name: 'Pay', exact: true }).click();
    await payRemainingByCard(waiter.page);
    await expect(waiter.page.getByRole('dialog').getByText('Check paid in full')).toBeVisible();
  } finally {
    await waiter.context.close();
  }
});

test('payment waits for the food: with an item still in the kitchen the dialog says so and the form is off', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter1');
  try {
    await openCheck(waiter.page, 2);
    await addDish(waiter.page, 'Cheesecake');
    await sendToKitchen(waiter.page);
    await expect(waiter.page.getByText(/Payment opens once every item is served/)).toBeVisible();
    await waiter.page.getByRole('button', { name: 'Pay', exact: true }).click();
    const dialog = waiter.page.getByRole('dialog');
    await expect(dialog.getByText(/1 item is not served yet/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Record payment' })).toBeDisabled();
    await waiter.page.keyboard.press('Escape');
    // served → the same dialog lets the cashier pay
    await kitchenFinishes(browser, waiter);
    await expect(itemRow(waiter.page, 'Cheesecake')).toHaveAttribute('data-status', 'served');
    await waiter.page.getByRole('button', { name: 'Pay', exact: true }).click();
    await expect(
      waiter.page.getByRole('dialog').getByRole('button', { name: 'Record payment' }),
    ).toBeEnabled();
    await payRemainingByCard(waiter.page);
    await expect(waiter.page.getByRole('dialog').getByText('Check paid in full')).toBeVisible();
  } finally {
    await waiter.context.close();
  }
});

test('report: each change of period is a history step, "Back" returns to the previous period', async ({
  browser,
}) => {
  const manager = await asRole(browser, 'manager');
  try {
    await manager.page.goto('/en/manager/reports');
    await expect(manager.page.getByTestId('report-total')).toBeVisible();
    await manager.page.getByRole('button', { name: '7 days' }).click();
    await expect(manager.page).toHaveURL(/from=.*&to=/);
    const sevenDays = manager.page.url();
    await manager.page.getByRole('button', { name: '60 days' }).click();
    await expect(manager.page).not.toHaveURL(sevenDays);
    await manager.page.goBack();
    await expect(manager.page).toHaveURL(sevenDays); // still on the report page
    await expect(manager.page.getByTestId('report-total')).toBeVisible();
  } finally {
    await manager.context.close();
  }
});

test('the tab title and chart tooltips are translated', async ({ browser }) => {
  const manager = await asRole(browser, 'manager');
  try {
    await manager.page.goto('/uk/manager/reports');
    await expect(manager.page).toHaveTitle('Ресторан');
    await expect(manager.page.getByTestId('report-total')).toBeVisible();
    const titles = await manager.page
      .locator('ul[aria-label] li[title]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''));
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.some((t) => /\d{4}-\d{2}-\d{2}/.test(t))).toBe(false);
  } finally {
    await manager.context.close();
  }
});

test('/orders/foo is a plain "not found" page', async ({ browser }) => {
  const waiter = await asRole(browser, 'waiter1');
  try {
    const res = await waiter.page.goto('/en/orders/foo');
    expect(res?.status()).toBe(404);
    await expect(waiter.page.getByText('highlighted fields')).toHaveCount(0);
  } finally {
    await waiter.context.close();
  }
});
