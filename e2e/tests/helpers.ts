import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  expect,
} from '@playwright/test';

/** Demo passwords: the defaults of .env.example, overridable through the same variables. */
export const creds = {
  waiter1: process.env.SEED_WAITER_PASSWORD ?? 'waiter-demo-pass',
  waiter2: process.env.SEED_WAITER_PASSWORD ?? 'waiter-demo-pass',
  cook1: process.env.SEED_COOK_PASSWORD ?? 'cook-demo-pass',
  manager: process.env.SEED_MANAGER_PASSWORD ?? 'manager-demo-pass',
} as const;

export type Role = keyof typeof creds;

/** A separate browser "device" already signed in as `role` (cookies from global setup). */
export const asRole = async (
  browser: Browser,
  role: Role,
): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext({ storageState: `.auth/${role}.json` });
  const page = await context.newPage();
  // Surface uncaught browser exceptions in the test log (otherwise they only show as a blank page).
  page.on('pageerror', (e) =>
    console.log(
      `[${role}] uncaught page error: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`,
    ),
  );
  return { context, page };
};

/** Opens the first free table with `guests` guests and returns the check id (from the URL). */
export const openCheck = async (page: Page, guests = 2): Promise<string> => {
  await page.goto('/en/tables');
  await page
    .getByRole('button', { name: /^Open the table: Table/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Number of guests').fill(String(guests));
  await dialog.getByRole('button', { name: 'Open the table' }).click();
  await page.waitForURL(/\/en\/orders\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop() as string;
};

/** Adds a dish from the menu; `pick` can choose modifiers/guest inside the dialog. */
export const addDish = async (
  page: Page,
  dish: string,
  pick?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>,
): Promise<void> => {
  await page.getByRole('button', { name: new RegExp(`^${dish}, `) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (pick) await pick(dialog);
  await dialog.getByRole('button', { name: /Add to the check/ }).click();
  await expect(dialog).toBeHidden();
};

export const itemRow = (page: Page, dish: string) =>
  page.locator('li[data-status]').filter({ hasText: dish }).first();

export const sendToKitchen = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /Send to kitchen/ }).click();
  await expect(page.locator('li[data-status="draft"]')).toHaveCount(0);
};

export const fetchOrder = async (request: APIRequestContext, id: string) => {
  const r = await request.get(`/api/orders/${id}`);
  expect(r.ok()).toBe(true);
  return (await r.json()) as {
    status: string;
    total: number;
    subtotal: number;
    serviceFee: number;
    paidAmount: number;
    payments: { amount: number; method: string; change: number }[];
    items: { id: string; status: string; dishName: string }[];
  };
};

/** Pays what is left with a card from the open payment dialog. */
export const payRemainingByCard = async (page: Page): Promise<void> => {
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Card (confirmed on the terminal)').click();
  await dialog.getByRole('button', { name: 'Record payment' }).click();
};

/** Marks every item of a check as served by driving the real kitchen flow through the API (test cleanup). */
export const finishAllItems = async (
  waiter: APIRequestContext,
  cook: APIRequestContext,
  id: string,
): Promise<void> => {
  const order = await fetchOrder(waiter, id);
  for (const item of order.items.filter((i) => ['sent', 'cooking'].includes(i.status))) {
    if (item.status === 'sent')
      await cook.patch(`/api/kitchen/items/${item.id}`, { data: { status: 'cooking' } });
    await cook.patch(`/api/kitchen/items/${item.id}`, { data: { status: 'ready' } });
  }
};

/** The check number shown in the page heading ("Check #12"). */
export const checkNumber = async (page: Page): Promise<number> => {
  const text = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
  const m = /#(\d+)/.exec(text);
  if (!m) throw new Error(`no check number in heading: ${text}`);
  return Number(m[1]);
};

/**
 * The cook's card for MY check. The seed also contains open checks, so "the first Cheesecake on the
 * screen" could be somebody else's: always identify the card by its check number.
 */
export const kitchenCard = (
  cook: Page,
  action: 'Start cooking' | 'Mark ready',
  dish: string,
  check: number,
) =>
  cook
    .getByRole('button', { name: new RegExp(`${action}: ${dish}`) })
    .filter({ hasText: `Check #${check} ` });

/**
 * The kitchen finishes every item of a check (API, as a cook) and the waiter serves it: payment is only
 * accepted once every item is served or cancelled. Items already served are left alone.
 */
export const kitchenFinishes = async (
  browser: Browser,
  waiter: { page: Page; context: BrowserContext },
): Promise<void> => {
  const orderId = waiter.page.url().split('/').pop() as string;
  const waiterRequest = waiter.context.request;
  const cook = await asRole(browser, 'cook1');
  try {
    const r = await waiterRequest.get(`/api/orders/${orderId}`);
    const order = (await r.json()) as { items: { id: string; status: string }[] };
    for (const item of order.items) {
      if (item.status === 'sent') {
        const a = await cook.context.request.patch(`/api/kitchen/items/${item.id}`, {
          data: { status: 'cooking' },
        });
        expect(a.ok()).toBe(true);
      }
      if (item.status === 'sent' || item.status === 'cooking') {
        const b = await cook.context.request.patch(`/api/kitchen/items/${item.id}`, {
          data: { status: 'ready' },
        });
        expect(b.ok()).toBe(true);
      }
      if (item.status !== 'served' && item.status !== 'cancelled') {
        const c = await waiterRequest.patch(`/api/orders/${orderId}/items/${item.id}`, {
          data: { status: 'served' },
        });
        expect(c.ok()).toBe(true);
      }
    }
  } finally {
    await cook.context.close();
  }
};
