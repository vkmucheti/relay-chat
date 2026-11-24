FROM node:24.15.0-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0 NG_CLI_ANALYTICS=false
RUN npm install -g pnpm@10.32.1
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=relay-pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --store-dir /pnpm/store --ignore-scripts --network-concurrency 8

FROM deps AS dev
COPY tsconfig.base.json ./
COPY packages/shared packages/shared/
COPY apps/web apps/web/
COPY infra/scripts/dev-web.sh infra/scripts/dev-watch.sh infra/scripts/
RUN pnpm --filter @relay/shared build
CMD ["sh", "infra/scripts/dev-web.sh"]

FROM dev AS build
RUN pnpm --filter @relay/web build
