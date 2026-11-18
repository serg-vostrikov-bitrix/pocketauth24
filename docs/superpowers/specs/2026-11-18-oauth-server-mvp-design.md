---
comet_change: oauth-server-mvp
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-18-oauth-server-mvp
status: final
---

# b24auth-server MVP — technical design

Requirements live in the OpenSpec delta specs of `oauth-server-mvp`
(`portal-registration`, `application-registry`, `token-service`, `event-delivery`). This
document refines `design.md` of the change into an implementable design. Protocol background:
`docs/research/2026-11-18-oauth-server-analysis.md`.

## 1. Stack and standards

| Concern | Choice | Note |
|---|---|---|
| Runtime | Node.js LTS, TypeScript strict, ESM | ntc-node-standards |
| HTTP | Fastify, `@fastify/formbody` with `qs.parse` | |
| DB | PostgreSQL 17, Drizzle ORM + drizzle-kit migrations | Drizzle over Prisma: no engine binaries to carry into a closed network |
| Tests | Vitest, Fastify `inject()` | |
| Lint/format | ESLint, Prettier | |
| Image | Multi-stage Dockerfile on a DHI Node base image, non-root | NTC Docker standard |

**Policy exception.** NTC defaults new projects to .NET. The project owner chose Node.js; a CTO
exception must be recorded (in the repo README and the NTC portal task) before task 1.2 starts.

**Justified deviations from NTC standards** (wire compatibility with the Bitrix24 protocol):

- Errors use the Bitrix shape `{"error", "error_description"}`, not RFC 7807.
- Callers authenticate with Bitrix client credentials, not 24IdP JWT.
- Flat layout (below) instead of `routes/<x>/{index,handlers,schemas,types}`: the service is
  small enough that the sample layout would be four files per twenty lines.

## 2. Layout

```
src/
├── app.ts             buildApp(): Fastify, formbody+qs, routes, GET /health
├── server.ts          migrate, listen, hourly token cleanup timer
├── config.ts          env parsing and validation
├── db.ts              pg Pool + drizzle instance
├── schema.ts          Drizzle tables
├── bitrix.ts          ok(result), fail(code, description, status), BitrixError
├── tokens.ts          issuePair(), refresh(), check(), tokenResponse()
├── routes/
│   ├── register.ts    POST /oauth/register/
│   ├── rpc.ts         POST /rest/:method — portal auth preHandler + method map
│   └── oauthToken.ts  GET|POST /oauth/token/
└── methods/
    ├── applications.ts  application.add / update / delete / list
    ├── tokens.ts        rest.authorize, rest.check
    └── events.ts        rest.event.call + deliver()
drizzle/               generated SQL migrations
test/                  unit, integration, contract, fixtures/*.har
```

The method map in `rpc.ts` is a plain object `{ 'rest.check': handler, ... }`; each handler gets
`(portal, body)` and returns the `result` value or throws `BitrixError`. Each method declares a
JSON Schema for its body; Fastify validates before the handler runs.

## 3. Configuration

| Variable | Meaning | Default |
|---|---|---|
| `BASE_URL` | Public URL of this server; used for `server_endpoint` | required |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `PORTAL_ALLOWLIST` | Comma-separated `host[:port]` allowed to register | required |
Constants, not config: token lifetimes 3600 s access / 180 days (6 months) refresh, as in the cloud, event POST timeout
10 s, event in-flight cap 200, log level `info`. Promote one to config when a customer needs it.

## 4. Data model

```
portals
  id            bigserial pk
  origin        text unique          -- lower-cased scheme://host[:port] from redirect_uri
  client_id     text unique
  secret_hash   text                 -- sha256 hex
  created_at    timestamptz

applications
  id            bigserial pk
  portal_id     bigint fk portals on delete cascade
  client_id     text unique          -- local.<14 hex>.<8 digits>
  secret_hash   text
  title, redirect_uri, scope text
  created_at    timestamptz

token_pairs
  id                  bigserial pk
  application_id      bigint fk applications on delete cascade
  access_hash         text unique
  refresh_hash        text unique
  user_id             integer
  scope               text
  params              jsonb          -- PARAMS from rest.authorize / item.auth from events
  access_expires_at   timestamptz
  refresh_expires_at  timestamptz
  created_at          timestamptz
  index (refresh_expires_at)         -- cleanup
```

No install state and no revocation column: the portal never calls install/uninstall for local
apps (`AppTable::uninstall` skips status `L`) and blocks uninstalled apps itself; deleting an app
cascades its tokens.

## 5. Flows

### 5.1 Registration — `POST /oauth/register/`

1. Parse `redirect_uri`; origin = `URL.origin` lower-cased. Its host[:port] not in the
   allowlist → 400 `{error: "access_denied"}`, nothing stored.
2. Generate `client_id` (random hex) and `client_secret` (`randomBytes(32)` hex).
3. Upsert by `origin`: new row, or overwrite `client_id` / `secret_hash` on the existing
   row. Licence fields (`BX_*`) are ignored until stage 2 (old credentials stop working; apps and tokens stay).
4. Respond `{client_id, client_secret}` at top level.

### 5.2 Portal RPC — `POST /rest/:method`

`preHandler`: look up portal by `client_id`, compare `sha256(client_secret)` with
`crypto.timingSafeEqual`. Failure → 401 `invalid_client`. Unknown method → 400
`ERROR_METHOD_NOT_FOUND`. The portal's extra fields (`client_redirect_uri`, `member_id`,
`bx24_request_id`) are ignored.

| Method | Behaviour |
|---|---|
| `application.add` | Insert app for the portal, return `{client_id, client_secret}` |
| `application.update` | Update title / redirect URI / scope where `client_id` and `portal_id` match; none → `ERROR_OAUTH` "Application not found" |
| `application.delete` | Delete where both match (cascade tokens); none → same error |
| `application.list` | `[]` |
| `rest.authorize` | App must belong to portal, else `ERROR_OAUTH` "Application not installed"; `issuePair()` |
| `rest.check` | `check()`; result per token-service spec |
| `rest.event.call` | See 5.4 |

### 5.3 Tokens (`tokens.ts`)

- `issuePair(app, portal, {scope, userId, params})`: two `randomBytes(32)` hex values, store
  hashes, return `tokenResponse()`.
- Scope = requested ∩ app scope (comma lists, trimmed); empty request → app scope.
- `tokenResponse()` fields: `access_token, refresh_token, expires, expires_in, scope, domain`
  (host of the portal origin), `server_endpoint` (`BASE_URL/rest/`), `client_endpoint`
  (`<portal origin>/rest/`), `member_id` (`md5(portal.client_id)`), `user_id`,
  `status: "L"`.
- `check(portal, token)`: find by `sha256(token)` joined to application with
  `portal_id = portal.id`; missing → `invalid_token`; `access_expires_at <= now` →
  `expired_token`; else `{client_id, expires, scope, member_id, user_id, parameters: params}`.
- `refresh(clientId, clientSecret, refreshToken)`: app by `client_id` and secret hash, else
  401 `invalid_client`; pair by `sha256(refreshToken)` and `application_id`, not expired, else
  400 `invalid_grant`; `issuePair()` with the old pair's user, scope and params. The old pair is
  left untouched (reusable until expiry; confirmed by capture in task 1.1).
- Cleanup: `setInterval` every hour, `DELETE FROM token_pairs WHERE refresh_expires_at < now()`.

### 5.4 Events — `rest.event.call`

1. Validate `QUERY` as an array of items (`client_id` optional, `auth`, `query.QUERY_URL`,
   `query.QUERY_DATA`, `additional`). Respond `{result: true}`.
2. For each item call `deliver()` without awaiting:
   - `inFlight >= 200` → log `event_dropped_overload`, return.
     `// ponytail: in-memory cap, persistent queue in stage 3`
   - `withUser = client_id && Number(auth.LOCAL_USER) > 0 && additional.sendAuth === "1"`.
   - `auth` = withUser ? `tokenResponse()` of a new pair (params = `item.auth`) minus
     `refresh_token` unless `additional.sendRefreshToken === "1"`, plus `application_token`;
     else `{domain, member_id, application_token}`.
   - Body = `qs.stringify({event, event_handler_id, data, ts, auth})`, form-encoded.
   - `fetch(QUERY_URL, {method: "POST", body, signal: AbortSignal.timeout(10_000),
     redirect: "manual"})`; non-2xx or error → log `event_delivery_failed` with portal,
     client_id, event, URL, status/error.

### 5.5 Token renewal — `/oauth/token/`

GET reads `request.query`, POST reads the form body. Only `grant_type=refresh_token`, else
400 `unsupported_grant_type`. Response is the token object at top level.

## 6. Error handling

- `BitrixError(code, description, status)` thrown anywhere → `{error, error_description}`.
- Fastify validation errors → 400 `invalid_request` with the first message.
- Anything else → 500 `{error: "internal_error"}`; full error to the log only.
- Status codes are a best guess (400 / 401 / 500) until compared with captured traffic; the
  portal client parses JSON regardless of status.

## 7. Edge cases

- `qs.parse` options: `depth: 20`, `parameterLimit: 10000`, `arrayLimit: 1000`; Fastify
  `bodyLimit` 10 MB for large event batches.
- Re-registration keeps apps; their tokens keep working, `member_id` in new tokens changes with
  the new service `client_id` (same as the portal's own computation).
- Allowlist: exact, case-insensitive host[:port] match; no wildcards.
- Volume: a pair per app page open, kept 6 months: ~10k pairs/day for 1000 active users gives
  ~1.8M rows at steady state — fine for PostgreSQL with the unique hash indexes.
- Behind a reverse proxy, `BASE_URL` defines `server_endpoint`; the Host header is not used.
- Event flags from PHP `http_build_query` arrive as `"1"` / `"0"` strings.

## 8. Testing strategy

Each spec scenario has one primary test at the HTTP boundary; unit tests exist only where a
table of cases is cheaper than HTTP calls. Audited with ntc-test-audit (see
`docs/openspec/changes/oauth-server-mvp/.comet/handoff/design-review.md`).

| Level | What | How |
|---|---|---|
| Integration (primary) | every scenario of the four delta specs, one test each, including events: install event with token, event without user, handler down, overload (201 hanging deliveries), early `result: true`, a nested `data` deeper than 5 levels arriving intact | `app.inject()` against real PostgreSQL (CI service container, local `docker compose up db`), `TRUNCATE` per file; a local `node:http` server as event handler; failures asserted on the captured pino log stream |
| Unit | scope intersection only, one table-driven test (empty request, subset, superset, spaces) | Vitest, pure function |
| Contract | our server driven through register → add → authorize → check → refresh; response keys, types and error codes compared with the HAR fixtures from task 1.1 (expected shapes come from the cloud, never from our serializer) | Vitest over `test/fixtures/*.har` |
| End-to-end | URL_INSTALL with tokens, REST calls, ONAPPINSTALL to a server-side app, renewal — on the test portal without internet | manual checklist (task 7.2) |

Time-dependent scenarios (expired access or refresh token) use `vi.useFakeTimers()`; expiry is
computed and compared in application code, not with SQL `now()`, so fake time applies.
"Install URL of a local app still runs" has no server-side test beyond "usable immediately"; its
real proof is the end-to-end check.

## 9. Deployment

- `Dockerfile`: build stage compiles TS; runtime stage on DHI Node, non-root, `node dist/server.js`.
- `server.ts` runs drizzle migrations on boot.
  `// ponytail: safe for one instance; add an advisory lock or a separate migrate command for several`
- `docker-compose.yml`: `app` + `postgres:17` with a volume; `.env.example` with `BASE_URL`,
  `DATABASE_URL`, `PORTAL_ALLOWLIST`.
- Closed network: image built outside, moved with `docker save` / `docker load`.
- TLS terminates at the customer's reverse proxy; the service listens on plain HTTP.
- CI (GitHub Actions): lint, typecheck, Vitest with a PostgreSQL service, image build, NTC
  reusable `ci-security.yml`.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Response formats differ from the cloud | Capture first (task 1.1); all shapes in `bitrix.ts` |
| Cloud actually rejects refresh reuse | Capture checks it; revert the spec in build if so |
| Node.js exception not approved | Decide before task 1.2; design ports to .NET with the same layout |
| Events lost on restart / outage / overload | Accepted for MVP, logged; stage 3 persistent queue |
| Portal caches `rest.check` 3600 s, including errors | Documented behaviour |
| Apps hard-code `oauth.bitrix.info` | Deployment guide: app config or DNS + internal CA |
| Unauthenticated `/oauth/register/` and `/rest/` let a peer who reaches the server take over an allowlisted portal's identity | App port bound to loopback; proxy allows both paths only from portal server IPs (deployment guide section 4). Residual: a host inside the portal's IP range |

## 11. Implementation Divergence

Recorded during verify (2026-11-18). The protocol capture against `oauth.bitrix.info`
(`docs/protocol-capture.md` section 6, fixtures `test/fixtures/*.har`) showed response details
that sections 5 and 6 inferred differently from the box sources. Build Task 14 aligned the code
and the delta specs with the cloud; the delta specs are canonical. Where this list and sections
5–6 disagree, this list wins.

| # | Area | Sections 5–6 say | Implemented (cloud behaviour) |
|---|---|---|---|
| 1 | `/oauth/register/` response | `{client_id, client_secret}` | adds `host` = portal hostname without port |
| 2 | `application.add` result | `{client_id, client_secret}` | adds `redirect_uri`, `scope` |
| 3 | `rest.authorize` token response | includes `user_id` | no `user_id` (the portal adds it) |
| 4 | `rest.check` result | `client_id, expires, scope, member_id, user_id, parameters` | `access_token, expires_in, expires, scope, client_id, parameters, status`; the portal reads the user from `parameters.LOCAL_USER` |
| 5 | `rest.check` `parameters` | stored values as given | integer-like strings returned as numbers (stored values unchanged) |
| 6 | `rest.check` unknown token | status "best guess" | HTTP 400 `invalid_token` / "Unable to get application by token"; `expired_token` stays 401 (not captured) |
| 7 | Refresh with wrong client | 401 `invalid_client` | 400 `invalid_client` |
| 8 | Error body | always `{error, error_description}` | `invalid_grant` and `invalid_client` on `/oauth/token/` have no `error_description` |
| 9 | Refresh response | same as the issue response | `scope` is the literal `"app"`, `domain` is the OAuth server host, includes `user_id`, no `client_id`; the stored pair scope is unchanged |
| 10 | Refresh check order | client first | pair lookup first: an unknown refresh token gives `invalid_grant` before the client is checked |
| 11 | Unsupported grant | `unsupported_grant_type` | unknown `grant_type` → 400 `invalid_request` "Invalid grant_type parameter or parameter missing"; `authorization_code` → 400 `invalid_grant` |
| 12 | `rest.event.call` result | `{"result": true}` | `{"result": null}` |
| 13 | Event `auth` without a user | `domain, member_id, application_token` | adds `client_endpoint`, `server_endpoint` |
| 14 | Event `auth` with a user | token response + `application_token` | also carries `user_id` |

Not captured and still inferred: the RPC statuses for `invalid_client` (401) and
`ERROR_METHOD_NOT_FOUND` (400), and the cloud shape of a token-bearing event `auth`.
