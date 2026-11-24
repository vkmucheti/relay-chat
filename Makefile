DEV = docker compose --project-name relay-dev --env-file .env -f infra/docker/compose.dev.yml
PROD = docker compose --project-name relay-prod --env-file .env.production -f infra/docker/compose.prod.yml

.PHONY: dev down logs seed test test\:e2e lint build prod-up clean
dev:
	$(DEV) up --build -d --wait
down:
	$(DEV) --profile e2e down
logs:
	$(DEV) --profile e2e logs -f
seed:
	$(DEV) exec -T api pnpm --filter @relay/api seed
test:
	pnpm test
test\:e2e:
	$(DEV) --profile e2e up --build -d --wait api-e2e
	pnpm --filter @relay/shared build
	pnpm test:e2e
lint:
	pnpm lint
build:
	pnpm build
prod-up:
	sh infra/scripts/init-local-production.sh
	$(PROD) up --build -d --wait
clean:
	$(DEV) --profile e2e down --volumes --remove-orphans
