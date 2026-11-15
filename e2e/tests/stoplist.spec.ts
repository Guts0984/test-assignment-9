import { expect, test } from '@playwright/test';
import {
  addDish,
  asRole,
  checkNumber,
  itemRow,
  kitchenCard,
  openCheck,
  payRemainingByCard,
  sendToKitchen,
} from './helpers';

test('manager puts a dish on the stop-list: it becomes unavailable for the waiter immediately, and a draft is flagged', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter1');
  const manager = await asRole(browser, 'manager');
  try {
    await openCheck(waiter.page, 2);
    const no = await checkNumber(waiter.page);
    await addDish(waiter.page, 'Cheesecake');
    await sendToKitchen(waiter.page);
    await addDish(waiter.page, 'Tiramisu'); // stays a draft
    const draft = itemRow(waiter.page, 'Tiramisu');
    await expect(draft).toHaveAttribute('data-status', 'draft');
    const menuButton = waiter.page.getByRole('button', { name: /^Tiramisu, / });
    await expect(menuButton).toBeEnabled();

    // The manager sets the remaining portions to 0 (stop-list).
    await manager.page.goto('/en/manager/menu');
    const stock = manager.page.getByLabel('Portions left: Tiramisu');
    await stock.fill('0');
    await stock.press('Enter');
    await expect(manager.page.getByText('Stop-list', { exact: true }).first()).toBeVisible();

    // The waiter's open screen reacts without a reload.
    await expect(menuButton).toBeDisabled();
    await expect(menuButton).toContainText('Stop-list');
    await expect(draft).toContainText('No longer available');
    await expect(waiter.page.getByRole('button', { name: /Send to kitchen/ })).toBeDisabled();

    // Remove it from the check, then lift the stop-list.
    await draft.getByRole('button', { name: /Remove/ }).click();
    await expect(draft).toHaveCount(0);
    await manager.page.getByLabel('Portions left: Tiramisu').fill('');
    await manager.page.getByLabel('Portions left: Tiramisu').press('Enter');
    await expect(menuButton).toBeEnabled();

    // finish the check
    const cook = await asRole(browser, 'cook1');
    try {
      await cook.page.goto('/en/kitchen');
      await kitchenCard(cook.page, 'Start cooking', 'Cheesecake', no).click();
      await kitchenCard(cook.page, 'Mark ready', 'Cheesecake', no).click();
    } finally {
      await cook.context.close();
    }
    await itemRow(waiter.page, 'Cheesecake').getByRole('button', { name: 'Served' }).click();
    await waiter.page.getByRole('button', { name: 'Pay', exact: true }).click();
    await payRemainingByCard(waiter.page);
    await expect(waiter.page.getByRole('dialog').getByText('Check paid in full')).toBeVisible();
  } finally {
    await waiter.context.close();
    await manager.context.close();
  }
});

test('the last portion: two waiters send it at the same time, one succeeds, the other is told and the dish is stop-listed for both', async ({
  browser,
}) => {
  const manager = await asRole(browser, 'manager');
  const w1 = await asRole(browser, 'waiter1');
  const w2 = await asRole(browser, 'waiter2');
  try {
    // exactly one portion of the Panna... use "Chocolate fondant" (limited stock in the seed)
    await manager.page.goto('/en/manager/menu');
    const stock = manager.page.getByLabel('Portions left: Chocolate fondant');
    await stock.fill('1');
    await stock.press('Enter');
    await expect(manager.page.getByText('1 left').first()).toBeVisible();

    await openCheck(w1.page, 2);
    await openCheck(w2.page, 2);
    await addDish(w1.page, 'Chocolate fondant');
    await addDish(w2.page, 'Chocolate fondant');
    const send = (p: typeof w1.page) => p.getByRole('button', { name: /Send to kitchen/ });
    await Promise.all([send(w1.page).click(), send(w2.page).click()]);

    // exactly one of them ended up with a SENT item, the other still has an (unavailable) draft
    const status = async (p: typeof w1.page) =>
      itemRow(p, 'Chocolate fondant').getAttribute('data-status');
    await expect
      .poll(async () => [await status(w1.page), await status(w2.page)].sort().join(','))
      .toBe('draft,sent');
    const loser = (await status(w1.page)) === 'draft' ? w1 : w2;
    await expect(loser.page.getByText('Not enough portions left.')).toBeVisible();
    await expect(itemRow(loser.page, 'Chocolate fondant')).toContainText('No longer available');
    await expect(loser.page.getByRole('button', { name: /^Chocolate fondant, / })).toBeDisabled();

    // restore stock so the suite is repeatable
    await manager.page.getByLabel('Portions left: Chocolate fondant').fill('8');
    await manager.page.getByLabel('Portions left: Chocolate fondant').press('Enter');
  } finally {
    await w1.context.close();
    await w2.context.close();
    await manager.context.close();
  }
});
