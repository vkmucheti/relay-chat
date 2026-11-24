# Implementation plan

- [x] A. Set up the pnpm workspace, shared contracts, development containers and service initialization.
- [x] B. Implement validated NestJS configuration, HTTP middleware, MongoDB models, authentication and users.
- [x] C. Implement contacts, conversations, message history, Kafka consumers, receipts and Redis-backed Socket.IO.
- [x] D. Add scoped object storage, multi-device presence, typing and Redis caches.
- [x] E. Build the Angular auth and chat UI, optimistic updates and reconnect backfill.
- [x] F. Add production Compose, Nginx, health, metrics, Grafana and CI.
- [x] G. Add the seed, automated tests, quick start and architecture documentation.
- [x] Complete the final re-run of development, two-gateway E2E and production TLS browser checks.

At every phase, run the applicable build, lint and tests and fix failures before extending the implementation. Record environmental blockers and rerun affected checks as soon as they are available.

## Verification

- Development startup and seed passed. Alice and Bob can sign in and see the seeded chats.
- Type checking, lint, builds, all eight unit tests and the dependency audit passed.
- Three integration tests passed against two gateways with real MongoDB, Redis, Kafka and MinIO.
- The two-context browser smoke passed on development HTTP and production Nginx TLS. Nginx logs confirmed WebSocket connections reached both production gateways.
