# b24auth-server

Replacement for the Bitrix24 cloud OAuth server (`oauth.bitrix.info` / `oauth.bitrix24.tech`)
for on-premise portals in a closed network: portal registration, local applications, token
issue, check and renewal, and event delivery to application handlers.

## Policy exception: Node.js instead of .NET

NTC defaults new projects to .NET. The project owner chose Node.js + TypeScript (Fastify,
Drizzle, PostgreSQL) for this service.

- Status: **pending CTO approval**
- Approved by / date: _to be filled in when the approval is recorded_
- NTC portal task: _link to be added when the approval is recorded_

If the exception is not approved, the design ports to .NET with the same layout
(`docs/superpowers/specs/2026-11-18-oauth-server-mvp-design.md`).

## Development

    npm install
    docker compose up -d db
    npm test

Configuration: `BASE_URL`, `DATABASE_URL`, `PORTAL_ALLOWLIST` (see `.env.example`).
Deployment: `docs/deployment.md`.
