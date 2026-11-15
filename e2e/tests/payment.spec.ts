import { expect, test } from '@playwright/test';
import { addDish, asRole, fetchOrder, kitchenFinishes, openCheck, sendToKitchen } from './helpers';

test('7 guests: split into 3, service fee included, the parts add up to the kopeck, three payments close the check', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter1');
  try {
    const id = await openCheck(waiter.page, 7);
    const guest = (n: number) => async (dialog: ReturnType<typeof waiter.page.getByRole>) => {
      await dialog.getByLabel('Guest').selectOption(String(n));
    };
    await addDish(waiter.page, 'Cheesecake', guest(1)); // 115,00
    await addDish(waiter.page, 'Americano', async (dialog) => {
      await dialog.getByLabel('Guest').selectOption('2'); // 55,00
    });
    await addDish(waiter.page, 'Espresso', async (dialog) => {
      await dialog.getByLabel('Guest').selectOption('3'); // 50,00
    });
    await sendToKitchen(waiter.page);
    await kitchenFinishes(browser, waiter);

    // 220,00 + 10% service fee (7 guests) = 242,00; on screen the same as on the server.
    await expect(waiter.page.getByTestId('subtotal')).toHaveText('₴220.00');
    await expect(waiter.page.getByTestId('service-fee')).toHaveText('₴22.00');
    await expect(waiter.page.getByTestId('total')).toHaveText('₴242.00');
    const server = await fetchOrder(waiter.context.request, id);
    expect([server.subtotal, server.serviceFee, server.total]).toEqual([22000, 2200, 24200]);

    await waiter.page.getByRole('button', { name: 'Pay', exact: true }).click();
    const dialog = waiter.page.getByRole('dialog');
    await dialog.getByText('Split equally', { exact: true }).click();
    await expect(dialog.getByLabel('Number of parts')).toHaveValue('3');
    // 242,00 / 3 = 80,67 + 80,67 + 80,66
    await expect(dialog.getByTestId('part-total')).toHaveText(['₴80.67', '₴80.67', '₴80.66']);
    await expect(dialog.getByText('Parts add up to ₴242.00')).toBeVisible();

    const pays = [
      { part: 0, method: 'cash', amount: '80.67', cash: '100' },
      { part: 1, method: 'card', amount: '80.67', cash: '' },
      { part: 2, method: 'cash', amount: '80.66', cash: '80.66' },
    ];
    for (const p of pays) {
      await dialog.getByRole('button', { name: 'Pay this part' }).first().click();
      await expect(dialog.getByLabel('Amount to pay')).toHaveValue(p.amount);
      if (p.method === 'cash') {
        await dialog.getByText('Cash', { exact: true }).click();
        await dialog.getByLabel('Cash received').fill(p.cash);
        if (p.cash === '100')
          await expect(dialog.getByTestId('change')).toHaveText('Change: ₴19.33');
      } else {
        await dialog.getByText('Card (confirmed on the terminal)').click();
      }
      await dialog.getByRole('button', { name: 'Record payment' }).click();
      await expect(
        dialog.getByRole('region', { name: 'Payments' }).getByRole('listitem'),
      ).toHaveCount(pays.indexOf(p) + 1);
    }

    await expect(dialog.getByText('Check paid in full')).toBeVisible();
    const done = await fetchOrder(waiter.context.request, id);
    expect(done.status).toBe('paid');
    expect(done.payments.map((p) => p.amount)).toEqual([8067, 8067, 8066]);
    expect(done.payments.reduce((a, p) => a + p.amount, 0)).toBe(done.total); // to the kopeck
    expect(done.payments[0]!.change).toBe(1933);
  } finally {
    await waiter.context.close();
  }
});

test('double click on "Record payment" records exactly one payment', async ({ browser }) => {
  const waiter = await asRole(browser, 'waiter1');
  try {
    const id = await openCheck(waiter.page, 2);
    await addDish(waiter.page, 'Cheesecake');
    await sendToKitchen(waiter.page);
    await kitchenFinishes(browser, waiter);
    await waiter.page.getByRole('button', { name: 'Pay', exact: true }).click();
    const dialog = waiter.page.getByRole('dialog');
    await dialog.getByText('Card (confirmed on the terminal)').click();
    await dialog.getByRole('button', { name: 'Record payment' }).dblclick();
    await expect(dialog.getByText('Check paid in full')).toBeVisible();
    const order = await fetchOrder(waiter.context.request, id);
    expect(order.payments).toHaveLength(1);
    expect(order.paidAmount).toBe(order.total);
  } finally {
    await waiter.context.close();
  }
});

test('payment survives a dropped connection: one payment even though the first response never arrives', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter1');
  try {
    const id = await openCheck(waiter.page, 2);
    await addDish(waiter.page, 'Cheesecake');
    await sendToKitchen(waiter.page);
    await kitchenFinishes(browser, waiter);
    await waiter.page.getByRole('button', { name: 'Pay', exact: true }).click();

    // First attempt: the request reaches the server, but the browser never gets the answer.
    let dropped = false;
    await waiter.page.route('**/api/orders/*/payments', async (route) => {
      if (!dropped) {
        dropped = true;
        await route.fetch(); // the server processes it…
        await route.abort('connectionreset'); // …but the response is lost
      } else {
        await route.continue();
      }
    });
    const dialog = waiter.page.getByRole('dialog');
    await dialog.getByText('Card (confirmed on the terminal)').click();
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog.getByText('Check paid in full')).toBeVisible({ timeout: 15_000 });
    expect(dropped).toBe(true);
    const order = await fetchOrder(waiter.context.request, id);
    expect(order.payments).toHaveLength(1); // the automatic retry carried the same payment id
  } finally {
    await waiter.context.close();
  }
});
