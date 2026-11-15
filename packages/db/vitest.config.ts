import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Real Postgres, real concurrency: give tests room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
  },
});
