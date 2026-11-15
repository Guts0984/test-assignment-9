import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
    // Real servers on real ports and a real database: keep files isolated but allow parallelism.
    pool: 'forks',
  },
  esbuild: { target: 'es2022' },
});
