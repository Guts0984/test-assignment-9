# Build context is the repository root:  docker build -f infra/stack-tests/Dockerfile .
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY infra/stack-tests/package.json infra/stack-tests/
RUN pnpm install --frozen-lockfile --filter @app/stack-tests...
COPY tsconfig.base.json ./
COPY infra/stack-tests infra/stack-tests
COPY docker-compose.yml ./
WORKDIR /repo/infra/stack-tests
CMD ["pnpm", "test:stack"]
