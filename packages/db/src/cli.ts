import { z } from 'zod';
import { createDb } from './client';
import { runMigrations } from './migrate';
import { seedDatabase } from './seed';

const baseEnv = z.object({
  DATABASE_URL: z.string().url(),
});

const seedEnv = baseEnv.extend({
  // Not sensitive: a business setting with a sane default.
  RESTAURANT_TZ: z.string().min(1).default('Europe/Kyiv'),
  RESTAURANT_DAY_START_HOUR: z.coerce.number().int().min(0).max(12).default(4),
  // Demo passwords come from the environment only (see .env.example), never from code.
  SEED_WAITER_PASSWORD: z.string().min(8),
  SEED_COOK_PASSWORD: z.string().min(8),
  SEED_MANAGER_PASSWORD: z.string().min(8),
  SEED_RESET: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const waitForDb = async (handle: ReturnType<typeof createDb>): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await handle.pool.query('select 1');
      return;
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`[db] waiting for postgres (attempt ${attempt})…`);
      await sleep(1000);
    }
  }
};

const main = async (): Promise<void> => {
  const command = process.argv[2];
  if (command !== 'migrate' && command !== 'seed' && command !== 'init') {
    console.error('usage: cli <migrate|seed|init>');
    process.exit(2);
  }
  const env = command === 'migrate' ? baseEnv.parse(process.env) : seedEnv.parse(process.env);
  const handle = createDb(env.DATABASE_URL, { max: 4, applicationName: 'db-init' });
  try {
    await waitForDb(handle);
    if (command === 'migrate' || command === 'init') {
      await runMigrations(handle.db);
      console.log('[db] migrations applied');
    }
    if (command === 'seed' || command === 'init') {
      const e = seedEnv.parse(process.env);
      const summary = await seedDatabase(handle.db, {
        tz: e.RESTAURANT_TZ,
        dayStartHour: e.RESTAURANT_DAY_START_HOUR,
        reset: e.SEED_RESET,
        passwords: {
          waiter: e.SEED_WAITER_PASSWORD,
          cook: e.SEED_COOK_PASSWORD,
          manager: e.SEED_MANAGER_PASSWORD,
        },
      });
      console.log(
        summary.seeded
          ? `[db] seeded: ${JSON.stringify(summary)}`
          : '[db] already seeded, skipping (set SEED_RESET=true to wipe and reseed)',
      );
    }
  } finally {
    await handle.close();
  }
};

main().catch((err: unknown) => {
  // Never print the connection string or passwords: zod issues only name the variable.
  console.error('[db] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
