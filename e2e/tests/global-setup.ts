import { chromium, type FullConfig } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { creds } from './helpers';

/**
 * Signs each role in ONCE and stores the session cookie. A stored session that is still valid is
 * reused, so repeated local runs stay far below the (deliberately strict) login rate limits.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:8080';
  mkdirSync('.auth', { recursive: true });
  const browser = await chromium.launch();
  for (const role of ['waiter1', 'waiter2', 'cook1', 'manager'] as const) {
    const file = `.auth/${role}.json`;
    if (existsSync(file)) {
      const existing = await browser.newContext({ baseURL, storageState: file });
      const me = await existing.request.get('/api/me');
      await existing.close();
      if (me.ok()) continue;
    }
    const context = await browser.newContext({ baseURL });
    const res = await context.request.post('/api/auth/login', {
      data: { username: role, password: creds[role] },
      headers: { origin: baseURL },
    });
    if (!res.ok()) throw new Error(`login ${role} failed: ${res.status()} ${await res.text()}`);
    await context.storageState({ path: file });
    await context.close();
  }
  await browser.close();
}
