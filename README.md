# b24auth-server

Replacement for the Bitrix24 cloud OAuth server (`oauth.bitrix.info` / `oauth.bitrix24.tech`)
for on-premise portals in a closed network: portal registration, local applications, token
issue, check and renewal, and event delivery to application handlers.

Stack: Node.js 24 + TypeScript, Fastify, Drizzle, PostgreSQL 17.

## Development

    npm install
    docker compose up -d db
    npm test

Configuration: `BASE_URL`, `DATABASE_URL`, `PORTAL_ALLOWLIST` (see `.env.example`).
Deployment: `docs/deployment.md`.

CI (`.github/workflows/ci.yml`): lint, typecheck and tests against PostgreSQL, a container
smoke run, and `npm audit` for production dependencies. Dependabot keeps npm packages, actions
and base images up to date.
