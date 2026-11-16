import { expect, test } from '@playwright/test';
import { asRole, kitchenFinishes, openCheck, payRemainingByCard, sendToKitchen } from './helpers';

test('keyboard-only sign in, with errors at the fields', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Username').focus();
  await page.keyboard.press('Enter'); // submit empty
  await expect(page.getByText('Enter your username')).toBeVisible();
  await expect(page.getByText('Enter your password')).toBeVisible();
  await expect(page.getByLabel('Username')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Username').fill('waiter2');
  await page.keyboard.press('Tab');
  await page.keyboard.type(process.env.SEED_WAITER_PASSWORD ?? 'waiter-demo-pass');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/en/tables');
  await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
});

test('wrong password shows a clear message and stays on the form', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Username').fill('cook1');
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong username or password')).toBeVisible();
  await expect(page).toHaveURL(/\/en\/login/);
});

test('people only see their own area: wrong-role and anonymous visits are redirected', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter1');
  const cook = await asRole(browser, 'cook1');
  const manager = await asRole(browser, 'manager');
  const anon = await browser.newContext();
  try {
    await waiter.page.goto('/en/kitchen');
    await waiter.page.waitForURL('**/en/tables');
    await waiter.page.goto('/en/manager/menu');
    await waiter.page.waitForURL('**/en/tables');
    await cook.page.goto('/en/tables');
    await cook.page.waitForURL('**/en/kitchen');
    await manager.page.goto('/en/kitchen');
    await manager.page.waitForURL('**/en/manager/menu');
    const page = await anon.newPage();
    await page.goto('/en/tables');
    await page.waitForURL('**/en/login');
    // and the API refuses direct requests regardless of the UI
    expect((await cook.context.request.get('/api/tables')).status()).toBe(403);
    expect((await waiter.context.request.post('/api/dishes', { data: {} })).status()).toBe(403);
    expect(
      (await anon.request.get('/api/orders/00000000-0000-4000-8000-000000000000')).status(),
    ).toBe(401);
  } finally {
    await waiter.context.close();
    await cook.context.close();
    await manager.context.close();
    await anon.close();
  }
});

test('Ukrainian and English: money formats, declensions (3 позиції / 5 позицій), language switch keeps the page', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter1');
  try {
    await waiter.page.goto('/uk/tables');
    await expect(waiter.page.getByRole('heading', { name: 'Столи' })).toBeVisible();
    await waiter.page
      .getByRole('button', { name: /^Відкрити стіл: Стіл/ })
      .first()
      .click();
    await waiter.page.getByRole('dialog').getByLabel('Кількість гостей').fill('2');
    await waiter.page.getByRole('dialog').getByRole('button', { name: 'Відкрити стіл' }).click();
    await waiter.page.waitForURL(/\/uk\/orders\//);
    await expect(waiter.page.getByText(/^Чек №\d+$/)).toBeVisible();

    const add = async (dish: string) => {
      await waiter.page.getByRole('button', { name: new RegExp(`^${dish}, `) }).click();
      await waiter.page
        .getByRole('dialog')
        .getByRole('button', { name: /Додати до чека/ })
        .click();
      await expect(waiter.page.getByRole('dialog')).toBeHidden();
    };
    await add('Cheesecake');
    await expect(waiter.page.getByRole('button', { name: /Відправити на кухню/ })).toContainText(
      '1 нова позиція',
    );
    await add('Espresso');
    await add('Still water');
    await expect(waiter.page.getByRole('button', { name: /Відправити на кухню/ })).toContainText(
      '3 нові позиції',
    );
    await add('Tiramisu');
    await add('Still water');
    await expect(waiter.page.getByRole('button', { name: /Відправити на кухню/ })).toContainText(
      '5 нових позицій',
    );

    // Ukrainian money: "115,00 ₴" (comma decimals, symbol last), not "₴115.00"
    await expect(waiter.page.getByRole('button', { name: /^Cheesecake, 115,00\s₴/ })).toBeVisible();
    await expect(waiter.page.getByText(/^\d[\d\s]*,\d\d\s₴$/).first()).toBeVisible();

    // Switch language in place: same check, English texts and English money.
    await waiter.page.getByRole('button', { name: 'EN', exact: true }).click();
    await waiter.page.waitForURL(/\/en\/orders\//);
    await expect(waiter.page.getByRole('button', { name: /Send to kitchen/ })).toContainText(
      '5 new items',
    );
    await expect(waiter.page.getByRole('button', { name: /^Cheesecake, ₴115\.00/ })).toBeVisible();

    await sendToKitchen(waiter.page);
    await kitchenFinishes(browser, waiter);
    await waiter.page.getByRole('button', { name: 'Pay', exact: true }).click();
    await payRemainingByCard(waiter.page);
    await expect(waiter.page.getByRole('dialog').getByText('Check paid in full')).toBeVisible();
  } finally {
    await waiter.context.close();
  }
});

test('manager report: the period lives in the URL (survives a reload), presets work, 60 days is the limit', async ({
  browser,
}) => {
  const manager = await asRole(browser, 'manager');
  try {
    const iso = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const today = new Date();
    const from = new Date(today.getTime() - 59 * 86_400_000);
    const url = `/en/manager/reports?from=${iso(from)}&to=${iso(today)}`;
    const started = Date.now();
    await manager.page.goto(url);
    await expect(manager.page.getByTestId('report-total')).toBeVisible();
    expect(Date.now() - started).toBeLessThan(5_000);
    await expect(manager.page.getByLabel('From')).toHaveValue(iso(from));
    const total = await manager.page.getByTestId('report-total').textContent();

    await manager.page.reload();
    await expect(manager.page.getByLabel('From')).toHaveValue(iso(from));
    await expect(manager.page.getByTestId('report-total')).toHaveText(total ?? '');

    await manager.page.getByRole('button', { name: '7 days' }).click();
    await expect(manager.page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    const sevenUrl = manager.page.url();
    await manager.page.reload();
    expect(manager.page.url()).toBe(sevenUrl);

    // 61 days is refused in the UI and never sent
    await manager.page.goto(
      `/en/manager/reports?from=${iso(new Date(today.getTime() - 61 * 86_400_000))}&to=${iso(today)}`,
    );
    await expect(manager.page.getByText('Choose at most 60 days')).toBeVisible();

    // Ukrainian formatting of the same report
    await manager.page.goto(`/uk/manager/reports?from=${iso(from)}&to=${iso(today)}`);
    await expect(manager.page.getByTestId('report-total')).toContainText('₴');
    await expect(manager.page.getByTestId('report-total')).toHaveText(/,\d\d\s₴$/);
  } finally {
    await manager.context.close();
  }
});

test('a check opened by mistake can be closed, and the table is free again', async ({
  browser,
}) => {
  const waiter = await asRole(browser, 'waiter2');
  try {
    await openCheck(waiter.page, 2);
    const order = waiter.page.url().split('/').pop();
    await waiter.page.getByRole('button', { name: 'Close empty check' }).click();
    await waiter.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close check', exact: true })
      .click();
    await waiter.page.waitForURL('**/en/tables');
    const check = await waiter.context.request.get(`/api/orders/${order}`);
    expect((await check.json()).status).toBe('closed'); // not a sale
    // and there is no open check left on the waiter's side
    const body = await (await waiter.context.request.get('/api/tables')).json();
    const tables: { orderId: string | null }[] = Array.isArray(body) ? body : body.tables;
    expect(tables.some((t) => t.orderId === order)).toBe(false);
  } finally {
    await waiter.context.close();
  }
});
