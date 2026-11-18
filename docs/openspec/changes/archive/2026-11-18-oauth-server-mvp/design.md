## Context

The on-premise portal talks to its OAuth server only through
`Bitrix\Rest\OAuth\Client` (rest module 26.x): form-encoded `POST {server}/rest/{method}`
calls carrying the portal's service credentials, plus `POST {server}/oauth/register/`.
Applications talk to the server directly at `/oauth/token/`. The server address comes
from `BITRIX_OAUTH_URL` or the `rest` / `oauth_server` option. Full protocol map:
`docs/research/2026-11-18-oauth-server-analysis.md`.

Constraints: runs inside a customer's closed network with no internet; installed and
operated by the customer's administrators; must not require changes to the Bitrix24
core; one server may serve several portals.

## Goals / Non-Goals

**Goals:**
- Wire-compatible subset of the cloud protocol that lets a local app open in the portal,
  call portal REST, renew its token, and receive the install event.
- Simple deployment for closed networks: one service plus one database.
- Protocol layer isolated from storage so later stages (authorization code, app.info,
  persistent queue) add endpoints without reshaping the core.

**Non-Goals:**
- `rest.code`, `/oauth/authorize/`, `authorization_code` grant, `/rest/app.info`.
- Licence signature verification, marketplace applications, admin UI, migration from a
  cloud-registered portal, persistent event queue and retries.

## Decisions

### D1. Architecture: one HTTP service, three API surfaces

```
 portal (rest module)                         application
   │  POST /oauth/register/                      │  /oauth/token/ (refresh_token)
   │  POST /rest/{method} (service creds)        │
   ▼                                             ▼
 ┌───────────────────────────────────────────────────────┐
 │ HTTP layer: form/JSON parsing, cloud-format responses │
 ├───────────────┬───────────────┬───────────────────────┤
 │ portal auth   │ app registry  │ token service         │
 │               │               │ event dispatcher ─────┼──▶ POST app handler
 ├───────────────┴───────────────┴───────────────────────┤
 │ storage: portals, applications, installations, tokens │
 └───────────────────────────────────────────────────────┘
```

Alternative considered: separate token and event services. Rejected for the MVP: more
moving parts to deploy in a closed network for no gain at expected volumes.

### D2. Opaque random tokens stored as hashes
Access and refresh tokens are random strings (≥ 32 bytes, URL-safe), stored as SHA-256
hashes with their metadata (portal, application, user, scope, parameters, expiry). Alternative: signed JWT. Rejected: the portal already calls
`rest.check` and caches the result for an hour, so self-contained tokens add no value and
make revocation on uninstall harder.

### D3. Reusable refresh tokens
Each refresh issues a new pair; the old refresh token stays valid until its own expiry.
This follows observed cloud behaviour (contrary to the public docs) and is confirmed by
the traffic capture. Alternative: single-use rotation. Rejected for compatibility: apps
that race two workers or lose the new refresh token would lose access for good.

### D4. Portal admission by allowlist
`/oauth/register/` carries no secret the server could check (licence hash is out of
scope), so registration is limited to configured portal hosts. Service calls are then
authenticated by the issued `client_id` / `client_secret` (secret stored hashed).

### D5. Event delivery in-process, best effort
`rest.event.call` responds immediately and starts each delivery in-process with a
per-request timeout and a cap on deliveries in flight. No persistence; overflow and
failures are logged. Stage 3 replaces the worker with a persistent queue behind the same interface.

### D6. Cloud-compatible response shapes
Portal RPC responses use `{"result": ...}` or `{"error", "error_description"}`;
`/oauth/token/` returns the token object at top level. Field names and error codes follow
what the rest module reads (see specs). Before freezing, the shapes are compared with
captured traffic from a test portal against the cloud server.

### D7. Stack
Node.js + TypeScript (Fastify, Drizzle, Vitest) with PostgreSQL, chosen in the design
phase; see the Design Doc. NTC policy defaults new projects to .NET, so a CTO exception
is recorded before implementation.

## Risks / Trade-offs

- [Cloud response formats only inferred from the box client] → capture real traffic on a
  test portal before the API is frozen; keep response building in one module.
- [Portal caches `rest.check` results, including errors, for 3600 s] → revocation takes
  effect on the portal only after its cache expires; documented as known behaviour.
- [Events lost on restart or handler outage] → accepted for the MVP; logged; stage 3 adds
  a persistent queue.
- [Apps hard-code `oauth.bitrix.info` for renewal] → deployment guide: app config change,
  or DNS override plus internal-CA certificate.
- [Allowlist is the only admission control] → document it; licence check comes in stage 2.

## Migration Plan

1. Deploy the service and database in the closed network, configure the portal allowlist
   and public base URL.
2. On the portal set `rest` / `oauth_server` to the server URL and clear
   `service_client_id` / `service_client_secret` so the portal re-registers.
3. Re-create (or re-save) local applications so they get credentials from the new server.
Rollback: restore the previous `oauth_server` value and service credentials (the portal
keeps their history in `b_option`).

## Open Questions

- Resolved for the token and check flows by the protocol capture (`docs/protocol-capture.md`).
  Still inferred, not captured: the RPC statuses for invalid service credentials (401
  `invalid_client`) and an unknown method (400 `ERROR_METHOD_NOT_FOUND`). The portal client parses
  the JSON body regardless of status, so a mismatch only affects logs.
