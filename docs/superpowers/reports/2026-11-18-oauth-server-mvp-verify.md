# Verification report: oauth-server-mvp

- Change: `oauth-server-mvp` (Comet Classic), branch `feature/20261118/oauth-server-mvp`
- Commit range: `9911496...HEAD` (HEAD = `edd543f`)
- Date: 2026-11-18
- Mode: read-only verification; no source, test, spec or doc was modified.

## Summary scorecard

| Dimension | Result | Notes |
|---|---|---|
| Completeness | PASS | 12/12 requirements implemented; 27/27 scenarios covered (26 by an integration test named after the scenario, 1 by the manual e2e checklist plus a supporting test); 20/20 tasks checked. |
| Correctness | PASS with warnings | Code matches the patched delta specs and the captured cloud traffic. Unconfirmed status codes for RPC `invalid_client` / unknown method and `expired_token`; e2e run did not block internet. |
| Coherence | NEEDS UPDATE | design.md (D1-D7) matches. The Design Doc was not updated after the build-phase Spec Patches: 14 drift items (see "Spec drift"). `tasks.md` 5.4 still names `unsupported_grant_type`. |

Severity counts: CRITICAL 0, IMPORTANT 0, WARNING 5, SUGGESTION 5.

## Checks run by coordinator

Given as facts, not re-run here:

- Build passes; `npm test` 54/54; typecheck and lint clean.
- All 20 tasks in `tasks.md` are checked.
- `openspec validate` passes.
- No hardcoded secrets.
- Contract tests compare our responses with real cloud captures (`test/fixtures/*.har`).
- Manual end-to-end run on a local portal passed all 10 steps (`docs/e2e-checklist.md`, "Run 2026-11-18"); outbound internet was not blocked.
- Spec Patches were applied during build to align error codes and response fields with the captured cloud behaviour (commits `649d873`, `d8efcc0`).

## Requirement -> code -> test mapping

Test files: `test/integration/portal-registration.test.ts` (PR), `application-registry.test.ts` (AR), `token-service.test.ts` (TS), `event-delivery.test.ts` (ED), `test/contract/cloud-shapes.test.ts` (CT), `test/unit/scope.test.ts` (UT).

### portal-registration

| Requirement / Scenario | Code | Test |
|---|---|---|
| Portal registration endpoint (`client_id`, `client_secret`, `host`) | `src/routes/register.ts:16-40` (response `:38`, upsert `:34-37`) | PR:25, CT:81 |
| Scenario: Allowed portal registers | `src/routes/register.ts:26-38` | PR:25 "Allowed portal registers" |
| Scenario: Portal re-registers | `src/routes/register.ts:34-37` (`onConflictDoUpdate` on `origin`) | PR:56 "Portal re-registers" |
| Registration allowlist; licence fields ignored | `src/routes/register.ts:26-28`, `:33`; `src/config.ts:29-32` | PR:25 (sends `BX_TYPE`), PR:42 |
| Scenario: Unknown portal is rejected | `src/routes/register.ts:27` (`access_denied`, 400) | PR:42 "Unknown portal is rejected" |
| Service call authentication | `src/routes/rpc.ts:38-51` (preValidation), `:56`, `:66`; portal scoping in every method query | PR:79, PR:90 |
| Scenario: Valid service credentials | `src/routes/rpc.ts:42-50` | PR:79 "Valid service credentials" |
| Scenario: Invalid service credentials | `src/routes/rpc.ts:47-49` (401 `invalid_client`) | PR:90 "Invalid service credentials" |
| Scenario: Unknown method | `src/routes/rpc.ts:66-68` | PR:105 "Unknown method" |

### application-registry

| Requirement / Scenario | Code | Test |
|---|---|---|
| Add local application (`client_id`, `client_secret`, `redirect_uri`, `scope`; `local.<14 hex>.<8 digits>`) | `src/methods/applications.ts:23-25`, `:27-45` | AR:35, CT:91 |
| Scenario: Portal creates a local app | same | AR:35 "Portal creates a local app" |
| Scenario: Local app is usable immediately | no install state: `src/schema.ts:20-31`; `src/methods/tokens.ts:23-35` | AR:54 "Local app is usable immediately" |
| Scenario: Install URL of a local app still runs | same as above (no server call on install finish) | Manual: `docs/e2e-checklist.md:21-22` step 4 (Pass, `:61`); supporting AR:54 |
| Update and delete local application | `src/methods/applications.ts:78-92`, `:94-102`; cascade `src/schema.ts:37-39` | AR:61, AR:77, AR:100 |
| Scenario: Scope update applies to new tokens | `src/methods/applications.ts:86`; `src/methods/tokens.ts:31` | AR:61 "Scope update applies to new tokens" |
| Scenario: Delete removes tokens | `src/methods/applications.ts:96-99`; `src/schema.ts:37-39` | AR:77 "Delete removes tokens" |
| Scenario: Foreign application | `src/methods/applications.ts:88-90`, `:98-100` | AR:100 "Foreign application" |
| Application list | `src/methods/applications.ts:47-50` | AR:29 |
| Scenario: Status sync | same | AR:29 "Status sync" |

### token-service

| Requirement / Scenario | Code | Test |
|---|---|---|
| Token response format; lifetimes 3600 s / 180 days; `member_id` = md5(service client_id) | `src/tokens.ts:42-48`, `:67-89`; `src/config.ts:1-2` | TS:50, CT:103 |
| Scenario: Fields present | same | TS:50 "Fields present" |
| Issue tokens for the portal (scope intersection, stored PARAMS, user = LOCAL_USER) | `src/methods/tokens.ts:23-35`; `src/tokens.ts:35-40`, `:91-119`, `:208-211` | TS:90, UT:4 |
| Scenario: App page opens | same | TS:90 "App page opens" |
| Scenario: Unknown application | `src/methods/tokens.ts:29` | TS:112 "Unknown application" |
| Validate tokens (result fields, numeric `parameters`, unknown -> 400) | `src/tokens.ts:132-162`; `src/methods/tokens.ts:45-47` | TS:142, CT:116 |
| Scenario: Valid token | same | TS:142 "Valid token" |
| Scenario: Unknown or foreign token | `src/tokens.ts:142-148` (join on `portal_id`) | TS:163 "Unknown or foreign token"; AR:77 for deleted app |
| Scenario: Expired token | `src/tokens.ts:149-151` | TS:182 "Expired token" |
| Token renewal (GET/POST, top-level, `user_id`, `scope: "app"`, `domain` = server host, reusable refresh, 400 errors without description) | `src/routes/oauthToken.ts:24-48`; `src/tokens.ts:166-199`; `src/bitrix.ts:29-37` | TS:194-270, CT:145 |
| Scenario: Successful renewal | `src/tokens.ts:186-198` | TS:194 "Successful renewal" |
| Scenario: Refresh token reused | `src/tokens.ts:185` (old pair untouched) | TS:213 "Refresh token reused" |
| Scenario: Refresh token expired or unknown | `src/tokens.ts:178`, `:182-184` | TS:228 "Refresh token expired or unknown"; AR:77 for deleted app |
| Scenario: Wrong application secret | `src/tokens.ts:179-181` | TS:242 "Wrong application secret" |
| Scenario: Unsupported grant type | `src/routes/oauthToken.ts:25-28` | TS:254 "Unsupported grant type" |
| Token storage safety | `src/tokens.ts:8-14` (`randomBytes`, sha256), `:103-112` | TS:129 |
| Scenario: Database leak | same | TS:129 "Database leak" |

### event-delivery

| Requirement / Scenario | Code | Test |
|---|---|---|
| Accept events, respond `{"result": null}` without waiting | `src/methods/events.ts:17-39`, `:131-134` | ED:28, CT:132 |
| Scenario: Portal hands over events | same | ED:28 "Portal hands over events" (handler holds responses) |
| Deliver once with a fresh token (auth block rules) | `src/methods/events.ts:41-71`, `:89-129` | ED:47, ED:89, CT event POST body |
| Scenario: Install event reaches a server-side app | `src/methods/events.ts:60-70` | ED:89 "Install event reaches a server-side app"; manual e2e step 7 |
| Scenario: Event without user auth | `src/methods/events.ts:43-53` | ED:47 "Event without user auth" |
| No retries; failures logged with portal, client_id, event, URL; nothing survives restart | `src/methods/events.ts:88-129` (in-memory only) | ED:144, ED:212 |
| Scenario: Handler is down | `src/methods/events.ts:121-125` | ED:144 "Handler is down" |
| Scenario: Overload | `src/methods/events.ts:97-101`; `src/config.ts:4` | ED:187 "Overload" (201 held deliveries) |

## Design decisions (design.md D1-D7)

| Decision | Status | Evidence |
|---|---|---|
| D1 One HTTP service, three surfaces | Match | `src/app.ts:39-41` |
| D2 Opaque random tokens, SHA-256 hashes, >= 32 bytes | Match | `src/tokens.ts:8-14`, `:99-106` (32 bytes hex) |
| D3 Reusable refresh tokens | Match; confirmed by capture | `src/tokens.ts:185`; `docs/protocol-capture.md:83` |
| D4 Allowlist admission, hashed service secret | Match | `src/routes/register.ts:26-32`; `src/routes/rpc.ts:47` |
| D5 In-process best-effort delivery, timeout, in-flight cap | Match | `src/methods/events.ts:97-118`, `:132` |
| D6 Cloud-compatible shapes, compared with capture | Match | `test/contract/cloud-shapes.test.ts:81-458` |
| D7 Node.js/TS, Fastify, Drizzle, Vitest, PostgreSQL; CTO exception | Match | `package.json`; `README.md:7-15` |

## Design Doc conformance (outside the drift list)

- Layout (section 2): matches file for file (`src/**`).
- Data model (section 4): `src/schema.ts:12-50` and `drizzle/0000_init.sql` match exactly, including cascades and the `refresh_expires_at` index.
- Constants (section 3): `src/config.ts:1-9` match (3600 s, 180 days, 10 s, 200, `info`, 10 MB body, qs options).
- Logging and redaction: query strings stripped from request logs (`src/app.ts:14-25`), handler URL reduced to origin+path (`src/methods/events.ts:78-86`, `:123`); tested at TS:272 and ED:212.
- Deployment (section 9): multi-stage DHI image (`Dockerfile:1-18`), migrations on boot with the ponytail note (`src/server.ts:9-10`), compose `app` + `postgres:17` bound to loopback (`docker-compose.yml`), `.env.example`, CI with PostgreSQL and `ci-security.yml` (`.github/workflows/ci.yml`), deployment guide with proxy restrictions (`docs/deployment.md:46-58`).
- Testing strategy (section 8): one primary integration test per scenario, named after it; unit test only for scope intersection; contract tests over HAR; manual e2e checklist. Fake timers used for expiry (TS:182, TS:228).

## Proposal goals / non-goals

- Goals met: register, RPC with service credentials, `application.add/update/delete/list`, `rest.authorize`, `rest.check`, `rest.event.call`, `/oauth/token/` refresh, configuration, logging, deployment unit.
- Non-goals not implemented: no `/oauth/authorize/`, no `rest.code` or `/rest/app.info` (fall to `ERROR_METHOD_NOT_FOUND`, `src/routes/rpc.ts:66-68`), `authorization_code` rejected (`src/routes/oauthToken.ts:25`), no licence verification (`src/routes/register.ts:33`), no persistent queue or retries, no admin UI, no migration tooling, no marketplace (`application.list` returns `[]`).

## Issues

### CRITICAL

None.

### IMPORTANT

None.

### WARNING

1. **Design Doc not updated after build-phase Spec Patches.** `docs/superpowers/specs/2026-11-18-oauth-server-mvp-design.md` sections 5.1-5.5, 6 and 8 still describe the pre-capture protocol (14 items, see "Spec drift"). The code and delta specs agree; the Design Doc is the outlier. Recommendation: before archive, update the Design Doc sections listed below to match the patched specs, and replace the "best guess" note in section 6 with the confirmed status codes.
2. **`tasks.md` task text is stale.** `docs/openspec/changes/oauth-server-mvp/tasks.md:28` (task 5.4) lists `unsupported_grant_type`; the spec (`specs/token-service/spec.md:76-78`) and code (`src/routes/oauthToken.ts:25-28`) use `invalid_request` / `invalid_grant`. Recommendation: reword task 5.4 to the patched error codes.
3. **E2E run did not prove the closed-network condition.** `docs/e2e-checklist.md:58` step 1 is "Partial": outbound internet was not blocked, and `:77-78` notes apps loaded `BX24` from `api.bitrix24.com`. Task 7.2 (`tasks.md:39`) requires "no internet". The server log evidence makes a cloud dependency unlikely, but it is not proven. Recommendation: repeat steps 1-9 with outbound traffic blocked (or record an explicit acceptance of the partial run), and add serving `BX24` from an internal host to `docs/deployment.md`.
4. **RPC error statuses are unconfirmed.** `src/routes/rpc.ts:48` returns 401 `invalid_client` and `:67` 400 `ERROR_METHOD_NOT_FOUND`; neither appears in `test/fixtures/cloud-capture.har`, and the Open Question in `docs/openspec/changes/oauth-server-mvp/design.md:105-107` is still open. The portal client parses JSON regardless of status, so impact is low. Recommendation: capture one bad-credential and one unknown-method call against the cloud, or close the Open Question by recording that the codes are inferred.
5. **Registration takeover is mitigated only by deployment.** `src/routes/register.ts:34-37` overwrites an allowlisted portal's credentials for any caller that reaches the endpoint (by design, D4; Design Doc section 10 last row). The mitigation is proxy IP restriction (`docs/deployment.md:49-58`). Recommendation: keep it as a known residual risk in the release notes; consider an optional `REGISTER_ALLOWED_IPS` or a registration-lock flag in stage 2 alongside the licence check.

### SUGGESTION

1. `expired_token` uses HTTP 401 (`src/tokens.ts:150`) while `invalid_token` uses 400; no capture covers it and the spec is silent. Note the choice in the Design Doc or align with 400.
2. `/oauth/register/` returns `host: url.hostname` (`src/routes/register.ts:38`, no port) while token `domain` uses `host` with port (`src/tokens.ts:46-48`). Matches the capture for a default-port portal; confirm for a portal on a non-default port.
3. The allowlist matches `host[:port]` but the portal record is keyed by `origin` (`src/routes/register.ts:26`, `:29`, `:37`), so `http://` and `https://` forms of the same host create two portal records. Consider documenting that the portal URL scheme must stay stable.
4. An event with `sendAuth` for an unknown or foreign `client_id` silently falls back to the no-user `auth` block (`src/methods/events.ts:59`). Consider a `warn` log so missing tokens can be diagnosed.
5. Cloud RPC responses carry a `time` object that we omit; the contract test compares only `result` (`test/contract/cloud-shapes.test.ts:258`, `:333-335`). Record this as a deliberate omission in `CLOUD_ONLY` or the Design Doc.

## Spec drift (delta spec vs Design Doc)

Each item: what the delta spec / code says vs what the Design Doc says.

1. Register response: spec `portal-registration/spec.md:7-8` and `src/routes/register.ts:38` return `host`; Design Doc 5.1 step 4 (line 117) says `{client_id, client_secret}` only.
2. `application.add` result: spec `application-registry/spec.md:5` and `src/methods/applications.ts:39-44` include `redirect_uri`, `scope`; Design Doc 5.2 table (line 128) says `{client_id, client_secret}`.
3. `rest.authorize` token response: spec `token-service/spec.md:4-8` and `src/tokens.ts:67-89` have no `user_id`; Design Doc 5.3 (lines 141-144) lists `user_id` in `tokenResponse()`.
4. `rest.check` result fields: spec `token-service/spec.md:32-35` and `src/tokens.ts:153-161` return `access_token, expires_in, expires, scope, client_id, parameters, status`; Design Doc 5.3 (line 147) says `{client_id, expires, scope, member_id, user_id, parameters}`.
5. Numeric `parameters`: `src/tokens.ts:131-139` converts numeric PARAMS strings to numbers (captured cloud behaviour, asserted at TS:157); Design Doc 5.3 says `parameters: params` with no conversion.
6. `rest.check` unknown token status: spec `token-service/spec.md:34-35` says HTTP 400; Design Doc section 6 (lines 180-181) still calls statuses a best guess; `expired_token` 401 (`src/tokens.ts:150`) is recorded nowhere.
7. Refresh `invalid_client` status: spec `token-service/spec.md:57` and `src/tokens.ts:180` (default 400) use 400; Design Doc 5.3 (line 149) says 401.
8. Refresh error body: spec `token-service/spec.md:57-58` and `src/bitrix.ts:30-36` omit `error_description` for `invalid_grant` / `invalid_client`; Design Doc section 6 (line 177) says every `BitrixError` yields `{error, error_description}`.
9. Refresh response `scope: "app"` and `domain` = OAuth server host: spec `token-service/spec.md:52-53` and `src/tokens.ts:191-198`; Design Doc 5.3 / 5.5 say only "token object at top level" with portal host `domain` from `tokenResponse()`.
10. Refresh check order: `src/tokens.ts:171-184` looks up the pair first (unknown token -> `invalid_grant` even with a wrong secret), then the client; Design Doc 5.3 (lines 148-150) checks the client first (-> `invalid_client`).
11. Unsupported grant type: spec `token-service/spec.md:76-78` and `src/routes/oauthToken.ts:25-28` return `invalid_request` (`invalid_grant` for `authorization_code`); Design Doc 5.5 (line 173) says 400 `unsupported_grant_type`.
12. `rest.event.call` result: spec `event-delivery/spec.md:6`, `:10` and `src/methods/events.ts:133` return `{"result": null}`; Design Doc 5.4 step 1 (line 157) and section 8 table (line 203, "early `result: true`") say `true`.
13. Event `auth` without user: spec `event-delivery/spec.md:19`, `:27` and `src/methods/events.ts:43-49` include `client_endpoint`, `server_endpoint`; Design Doc 5.4 (line 164) says `{domain, member_id, application_token}`.
14. Event `auth` with user: spec `event-delivery/spec.md:16-17` and `src/methods/events.ts:65-70` add `user_id`; Design Doc 5.4 (lines 162-163) says token response plus `application_token` only.

Minor (not spec-driven): Design Doc section 10 says "all shapes in `bitrix.ts`", but response shapes live in `src/tokens.ts` and `src/methods/*`; the 404 `not_found` handler (`src/app.ts:35-37`) is not described in section 6.

Design Doc location and frontmatter: `docs/superpowers/specs/2026-11-18-oauth-server-mvp-design.md:1-5` has `comet_change: oauth-server-mvp`, `role: technical-design`, `canonical_spec: openspec`. PASS.

## Resolution (coordinator, 2026-11-18)

| Warning | Resolution |
|---|---|
| W1 Design Doc drift | Owner chose option A: Design Doc section 11 "Implementation Divergence" lists all 14 items (commit e08819f). Delta specs stay canonical. |
| W2 tasks.md 5.4 stale | Reworded to `invalid_request` (unknown grant type) in a short build round (commit 7ee6142). |
| W3 closed-network e2e not proven | Owner chose to rerun. All 10 steps passed with the portal's PHP container blocked from the internet and `BX24` served locally (`docs/e2e-checklist.md`, "Run 2026-11-18 (closed network)"). `docs/deployment.md` section 7a now covers serving `BX24` internally, the portal port and app host names. |
| W4 RPC statuses unconfirmed | Open Question in `design.md` closed by recording the two statuses as inferred; the portal parses the body regardless of status. Accepted. |
| W5 registration takeover | Known residual risk by design (D4), mitigated in `docs/deployment.md` section 4 and listed in Design Doc section 10. Accepted; candidate for stage 2. |

Suggestions S1–S5 are left for later stages; none affects correctness or security.

Fresh evidence after the resolution commits: `npm run build` passes; `npm test` 9 files, 54 tests
pass; typecheck and lint clean; `openspec validate oauth-server-mvp` passes.

## Final assessment

All checks pass. No CRITICAL or IMPORTANT issues; all five warnings are resolved or explicitly
accepted as recorded above. Ready for archive.
