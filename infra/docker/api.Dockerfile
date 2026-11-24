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
RUN pnpm rebuild argon2 && pnpm rebuild esbuild

FROM deps AS bucket-init
COPY apps/api/init-bucket.mjs apps/api/
COPY infra/scripts/init-bucket.sh infra/scripts/
CMD ["sh", "infra/scripts/init-bucket.sh"]

FROM deps AS dev
COPY tsconfig.base.json ./
COPY packages/shared packages/shared/
COPY apps/api apps/api/
COPY infra/scripts/dev-api.sh infra/scripts/dev-watch.sh infra/scripts/
RUN pnpm --filter @relay/shared build && pnpm --filter @relay/api build
CMD ["sh", "infra/scripts/dev-api.sh"]

FROM dev AS build
RUN --mount=type=cache,id=relay-pnpm,target=/pnpm/store,sharing=locked pnpm --filter @relay/api deploy --prod --store-dir /pnpm/store /app && test -f /app/dist/main.js && test -f /app/node_modules/@relay/shared/dist/index.js

FROM node:24.15.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
