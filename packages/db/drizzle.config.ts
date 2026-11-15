import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  // Only used by `drizzle-kit` commands that touch a database; `generate` does not need it.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
