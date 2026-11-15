import { expect, test } from '@playwright/test';
import {
  addDish,
  asRole,
  checkNumber,
  fetchOrder,
  itemRow,
  kitchenCard,
  openCheck,
  payRemainingByCard,
  sendToKitchen,
} from './helpers';

test('order with modifiers → kitchen → ready: the waiter sees it WITHOUT reloading', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter1');
  const cook = await asRole(browser, 'cook1');
  try {
    // The cook's screen is already open and idle…
    await cook.page.goto('/en/kitchen');
    await expect(cook.page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();

    // …while the waiter takes an order with modifiers.
    const id = await openCheck(waiter.page, 2);
    const no = await checkNumber(waiter.page);
    await waiter.page.evaluate(
      () => ((window as unknown as { __noReload: string }).__noReload = 'still-the-same-page'),
    );
    await addDish(waiter.page, 'Ribeye steak', async (dialog) => {
      await dialog.getByRole('radio', { name: /^Medium/ }).check();
      await dialog.getByRole('radio', { name: /^Fries/ }).check();
      await dialog.getByRole('checkbox', { name: /^Pepper sauce/ }).check();
      await dialog.getByLabel('Comment for the kitchen').fill('no salt');
    });
    const row = itemRow(waiter.page, 'Ribeye steak');
    await expect(row).toContainText('Medium');
    await expect(row).toContainText('Pepper sauce');
    await expect(row).toContainText('₴645.00'); // 620 + 25 sauce
    await expect(row).toHaveAttribute('data-status', 'draft');
    await sendToKitchen(waiter.page);
    await expect(row).toHaveAttribute('data-status', 'sent');

    // The new item shows up on the kitchen screen by itself, with modifiers and comment.
    const card = kitchenCard(cook.page, 'Start cooking', 'Ribeye steak', no);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Medium');
    await expect(card).toContainText('Pepper sauce');
    await expect(card).toContainText('“no salt”');
    await expect(card.getByTestId('timer')).toBeVisible();
    // No prices on the kitchen screen.
    await expect(cook.page.locator('main')).not.toContainText('₴');

    // The cook clicks: cooking. The waiter's screen follows.
    await card.click();
    await expect(row).toHaveAttribute('data-status', 'cooking');
    // …and clicks again: ready.
    await kitchenCard(cook.page, 'Mark ready', 'Ribeye steak', no).click();
    await expect(row).toHaveAttribute('data-status', 'ready');
    await expect(row.getByRole('button', { name: 'Served' })).toBeVisible();

    // The waiter's page never reloaded.
    expect(
      await waiter.page.evaluate(() => (window as unknown as { __noReload: string }).__noReload),
    ).toBe('still-the-same-page');

    // Serve and pay.
    await row.getByRole('button', { name: 'Served' }).click();
    await expect(row).toHaveAttribute('data-status', 'served');
    await waiter.page.getByRole('button', { name: 'Pay', exact: true }).click();
    await payRemainingByCard(waiter.page);
    await expect(waiter.page.getByRole('dialog').getByText('Check paid in full')).toBeVisible();
    const order = await fetchOrder(waiter.context.request, id);
    expect(order.status).toBe('paid');
    expect(order.payments).toHaveLength(1);
  } finally {
    await waiter.context.close();
    await cook.context.close();
  }
});

test('cancelling before cooking is possible, after cooking it is not (and the kitchen sees the cancellation live)', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter1');
  const cook = await asRole(browser, 'cook1');
  try {
    await cook.page.goto('/en/kitchen');
    await openCheck(waiter.page, 2);
    const no = await checkNumber(waiter.page);
    await addDish(waiter.page, 'Tiramisu');
    await addDish(waiter.page, 'Cheesecake');
    await sendToKitchen(waiter.page);
    await expect(kitchenCard(cook.page, 'Start cooking', 'Tiramisu', no)).toBeVisible();
    await expect(kitchenCard(cook.page, 'Start cooking', 'Cheesecake', no)).toBeVisible();

    // Cancel the tiramisu: it vanishes from the kitchen on its own.
    const tiramisu = itemRow(waiter.page, 'Tiramisu');
    await tiramisu.getByRole('button', { name: /Cancel/ }).click();
    await expect(tiramisu).toHaveAttribute('data-status', 'cancelled');
    await expect(kitchenCard(cook.page, 'Start cooking', 'Tiramisu', no)).toHaveCount(0);

    // Once the cook starts the cheesecake the cancel button disappears.
    const cheesecake = itemRow(waiter.page, 'Cheesecake');
    await kitchenCard(cook.page, 'Start cooking', 'Cheesecake', no).click();
    await expect(cheesecake).toHaveAttribute('data-status', 'cooking');
    await expect(cheesecake.getByRole('button')).toHaveCount(0);

    // finish the check
    await kitchenCard(cook.page, 'Mark ready', 'Cheesecake', no).click();
    await expect(cheesecake).toHaveAttribute('data-status', 'ready');
    await cheesecake.getByRole('button', { name: 'Served' }).click();
    await waiter.page.getByRole('button', { name: 'Pay', exact: true }).click();
    await payRemainingByCard(waiter.page);
    await expect(waiter.page.getByRole('dialog').getByText('Check paid in full')).toBeVisible();
  } finally {
    await waiter.context.close();
    await cook.context.close();
  }
});
