# Build context is the repository root:  docker build -f packages/db/Dockerfile .
FROM node:22-slim
RUN corepack enable
WORKDIR /repo

# Install only what the db package needs (cached unless manifests change).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @app/db...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/db packages/db

USER node
WORKDIR /repo/packages/db
# Migrations and seed run in one go; seeding is skipped when data already exists.
CMD ["node", "--import", "tsx", "src/cli.ts", "init"]
