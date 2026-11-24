# Relay Chat

Relay is a browser chat app for direct conversations and groups. Messages travel through Kafka and MongoDB before Socket.IO fans them out across gateways. Redis tracks presence and typing. MinIO serves private image and file attachments using short-lived signed URLs.

## Quick start

Prerequisites are Docker Engine with Compose v2 or later, Make, and an internet connection for the first build. Allocate about 8 GB to Docker Desktop for the full stack. The first build compiles a pinned MinIO Community release.

```sh
cp .env.example .env
make dev
make seed
```

Open [Relay](http://localhost:4200) in two browser profiles or an ordinary and a private window. Sign in as `alice` in one and `bob` in the other, both with `RelayDemo2026!`. Their direct chat and the **Weekend plans** group already contain messages. The sample accounts `carla`, `dev`, and `eva` use the same password.

| Service                | Development URL                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Angular app            | [localhost:4200](http://localhost:4200)                                                              |
| Nest API and readiness | [localhost:3000/health/ready](http://localhost:3000/health/ready)                                    |
| OpenAPI / Swagger      | [localhost:3000/api/docs](http://localhost:3000/api/docs)                                            |
| Kafka UI               | [localhost:8080](http://localhost:8080)                                                              |
| Mongo Express          | [localhost:8081](http://localhost:8081)                                                              |
| Redis Insight          | [localhost:5540](http://localhost:5540), add database `redis:6379`                                   |
| MinIO object endpoint  | [localhost:9000](http://localhost:9000)                                                              |
| MinIO Console          | [localhost:9001](http://localhost:9001), use `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` from `.env` |
| Prometheus             | [localhost:9090](http://localhost:9090)                                                              |
| Grafana                | [localhost:3002](http://localhost:3002), use the `GRAFANA_ADMIN_*` settings                          |

The Angular development server proxies `/api` and `/socket.io` to the gateway. Web and API source files are mounted for hot reload. Re-run `make dev` after changing dependencies or Docker configuration. For direct Compose use, run `docker compose -f infra/docker/compose.dev.yml up --build` from the repository root. If you customize `.env`, add `--env-file .env` before `-f` so Compose uses those values for port and service interpolation.

## Tests and tooling

Install Node.js 24.15+ on the 24 line or Node.js 26 and pnpm 10.32.1 for host-side commands.

```sh
npm install --global pnpm@10.32.1
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
make test
make test:e2e
```

On a Linux CI image, install Chromium system dependencies with `pnpm exec playwright install --with-deps chromium`. To use installed Chrome locally, set `E2E_BROWSER_CHANNEL=chrome`.

`make test` runs Nest and Angular Jest tests. `make test:e2e` starts a second development API gateway on port 3001, then runs Supertest and Socket.IO integration tests against the two gateways and launches Playwright smoke tests for two-browser chat and protected profile and group navigation. Tests create accounts with unique names. Set `E2E_API_URL`, `E2E_SECOND_API_URL` and `E2E_WEB_URL` if you customize the corresponding ports. `make lint`, `pnpm typecheck` and `make build` run static checks and builds. Husky installs hooks when the workspace has been initialized with Git.

## Production-like stack

`make prod-up` creates local secrets and a 30-day self-signed localhost certificate if `.env.production` is absent. It starts two gateways and two workers and serves the production Angular bundle at [https://localhost:8443](https://localhost:8443). [http://localhost:8088](http://localhost:8088) redirects to TLS. Grafana is loopback-only on port 3003. Register new accounts in this stack. Production and development storage volumes are separate.

For deployment, copy `.env.production.example` to `.env.production`, replace the marked values, and point `RELAY_TLS_DIR` to a directory with `fullchain.pem` and `privkey.pem`. Configure a trusted certificate and matching DNS, CORS origin and public storage endpoint. Set `RELAY_HTTPS_PUBLIC_PORT` to the port suffix used in redirects, such as `:8443` or `:443`. See [architecture and deployment notes](ARCHITECTURE.md) for the managed data services and controls required for an internet-facing installation.

## Troubleshooting

| Symptom                                      | Check                                                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker cannot connect                        | Start Docker Desktop or the Docker daemon, then run `docker info`.                                                                              |
| An initialization job fails                  | Run `make logs` and check `mongo-init`, `kafka-init`, or `minio-init`. Init jobs are safe to rerun.                                             |
| Registration or refresh fails behind a proxy | Use the browser origin in `CORS_ORIGINS` and serve HTTPS when `COOKIE_SECURE=true`. In development use `localhost` consistently.                |
| Attachment upload fails                      | Check the browser can reach `S3_PUBLIC_ENDPOINT` as configured. A PUT signs the host, content type, byte length and conditional header.         |
| Messages stay pending or fail                | Check the connection banner, worker logs and Grafana Kafka lag and DLQ panels. Retry the message using the bubble action.                       |
| Port is already in use                       | Set the published port in `.env`. If the web port changes, update `CORS_ORIGINS`. For development E2E set the corresponding test URL variables. |
| TLS fails after replacing files              | Run `make prod-up` to refresh the TLS volume, then restart the Nginx container so it reopens the certificate.                                   |

`make down` stops development without deleting persisted data. `make clean` removes the development containers and all their named volumes.
