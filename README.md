# b24auth-server

Replacement for the Bitrix24 cloud OAuth server (`oauth.bitrix.info` / `oauth.bitrix24.tech`)
for on-premise portals in a closed network: portal registration, local applications, token
issue, check and renewal, and event delivery to application handlers.

## Policy exception: Node.js instead of .NET

NTC defaults new projects to .NET. The project owner chose Node.js + TypeScript (Fastify,
Drizzle, PostgreSQL) for this service.

- Status: **approved**
- Approved by / date: the CTO (also the project owner), 2026-11-18

If the exception is withdrawn, the design ports to .NET with the same layout
(`docs/superpowers/specs/2026-11-18-oauth-server-mvp-design.md`).

## Development

    npm install
    docker compose up -d db
    npm test

Configuration: `BASE_URL`, `DATABASE_URL`, `PORTAL_ALLOWLIST` (see `.env.example`).
Deployment: `docs/deployment.md`.
