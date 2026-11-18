## 1. Protocol capture and project setup

- [ ] 1.1 Capture real request/response pairs from a test on-premise portal against the cloud server with `mitmdump` in reverse mode (HAR export) for `/oauth/register/`, `rest.authorize`, `rest.check`, `application.add`, `rest.event.call`, `/oauth/token/` and an event POST to a handler; refresh twice with the same refresh token to confirm reuse behaviour; store sanitized fixtures in the repo
- [ ] 1.2 Create the Node.js + TypeScript Fastify service skeleton (CTO exception recorded): config loading (base URL, portal allowlist, DB connection, event timeout and in-flight cap), structured logging, health endpoint
- [ ] 1.3 Add container image and docker-compose for offline deployment with the database
- [ ] 1.4 Set up test runner and CI checks

## 2. Storage

- [ ] 2.1 Define schema and migrations for portals, applications and token pairs (hashed values, metadata, expiry); every query filters by the calling portal

## 3. Portal registration and authentication

- [ ] 3.1 Implement `POST /oauth/register/` with allowlist check, new and repeated registration
- [ ] 3.2 Implement service-credential authentication for `POST /rest/{method}`, method dispatch with `invalid_client` and `ERROR_METHOD_NOT_FOUND` errors, and `result` / `error` response helpers

## 4. Application registry

- [ ] 4.1 Implement `application.add` with `local.*` client_id format
- [ ] 4.2 Implement `application.update` and `application.delete` with ownership check; delete cascades tokens
- [ ] 4.3 Implement `application.list` returning an empty list

## 5. Token service

- [ ] 5.1 Implement secure token generation, hashing and the token response builder (including `member_id`)
- [ ] 5.2 Implement `rest.authorize` with scope intersection and stored `PARAMS`
- [ ] 5.3 Implement `rest.check` with `invalid_token` / `expired_token` errors
- [ ] 5.4 Implement `/oauth/token/` (GET and POST) for `refresh_token` with reusable refresh tokens and `invalid_grant` / `invalid_client` / `unsupported_grant_type` errors

## 6. Event delivery

- [ ] 6.1 Implement `rest.event.call` intake and fire-and-forget delivery with timeout and in-flight cap
- [ ] 6.2 Implement the handler POST with the `auth` block rules (`sendAuth`, `sendRefreshToken`, no-user events)
- [ ] 6.3 Log delivery failures without retries

## 7. Verification and documentation

- [ ] 7.1 Contract tests comparing responses with the captured fixtures from 1.1
- [ ] 7.2 End-to-end check on the test portal with no internet: local app with UI runs its `URL_INSTALL` page with tokens, finishes installation via `BX24.installFinish`, then opens and calls REST; server-side local app receives `ONAPPINSTALL` with tokens; both renew tokens via `/oauth/token/`
- [ ] 7.3 Write the deployment guide: server setup, portal `oauth_server` switch and re-registration, re-creating local apps, app renewal URL (config change or DNS plus internal-CA certificate), rollback
