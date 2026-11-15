import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/app/i18n/request.ts');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  // Trace files from the monorepo root so the standalone build includes @app/shared.
  outputFileTracingRoot: root,
  transpilePackages: ['@app/shared'],
  poweredByHeader: false,
  // Linting runs as its own step (root `pnpm lint`, CI); no second pass during the build.
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: true,
  // `next dev` without nginx: forward /api/* to the API (in compose nginx does this instead).
  async rewrites() {
    const api = process.env.API_ORIGIN;
    return api ? [{ source: '/api/:path*', destination: `${api}/:path*` }] : [];
  },
};

export default withNextIntl(config);
