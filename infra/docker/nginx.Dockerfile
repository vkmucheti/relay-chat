FROM node:24.15.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0 NG_CLI_ANALYTICS=false
RUN npm install -g pnpm@10.32.1
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=relay-pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --store-dir /pnpm/store --ignore-scripts --network-concurrency 8
COPY tsconfig.base.json ./
COPY packages/shared packages/shared/
COPY apps/web apps/web/
RUN pnpm --filter @relay/shared build && pnpm --filter @relay/web build

FROM nginx:1.28.0-alpine
COPY --from=build /workspace/apps/web/dist/relay/browser/ /var/www/relay/
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/site.conf.template /etc/nginx/site.conf.template
COPY infra/nginx/headers.conf /etc/nginx/headers.conf
COPY infra/nginx/entrypoint.sh /usr/local/bin/relay-nginx
USER nginx
EXPOSE 8080 8443
ENTRYPOINT ["sh", "/usr/local/bin/relay-nginx"]
